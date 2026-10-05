import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { shortCode } from '../../common/utils/slug.util';
import { CreateQrBatchDto, ResolveScanDto } from './dto/qr.dto';
import { BusReviewsService } from '../fleet/bus-reviews.service';
import { TripsService } from '../fleet/trips.service';
import { PROGRAMME_CARD, ProgrammingService } from '../programming/programming.service';
import { Prisma } from '@prisma/client';

type ProgrammeCard = Prisma.ArticleGetPayload<{ select: typeof PROGRAMME_CARD }>;

@Injectable()
export class QrService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private busReviews: BusReviewsService,
    private programming: ProgrammingService,
    private trips: TripsService,
  ) {}

  /**
   * The heart of the product: a sticker scan resolves to that bus's programme.
   *
   * Returns the route, the stories programmed for this bus and direction (see
   * programming/content-for.ts), the route's live notices, the businesses that
   * target the corridor, and the offline pack manifest the PWA should cache at once
   * while the bus still has signal at the park.
   */
  async resolve(code: string, dto: ResolveScanDto = {}, ip?: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { shortCode: code },
      include: {
        operator: { select: { id: true, name: true, slug: true, logoUrl: true, verification: true, isActive: true } },
        route: true,
        vehicle: { select: { id: true, plateNo: true, label: true, isActive: true, routeId: true, route: true } },
      },
    });
    // An archived bus's stickers stop working until it is restored, as its public profile does.
    if (!qr || !qr.isActive || (qr.vehicle && !qr.vehicle.isActive)) {
      throw new NotFoundException('This code is not active');
    }

    // Record the scan. First-scan detection drives the funnel metric in Phase 0.
    // findFirst + index beats count(): we only need existence, not a total,
    // and this runs on every scan against a table that only ever grows.
    // A refresh (the traveller choosing a direction) is the same visit, not a new scan.
    let isFirstScan = true;
    if (dto.sessionId && !dto.refresh) {
      const seen = await this.prisma.scanEvent.findFirst({
        where: { sessionId: dto.sessionId }, select: { id: true },
      });
      isFirstScan = !seen;
      await this.prisma.scanEvent.create({
        data: {
          qrCodeId: qr.id,
          sessionId: dto.sessionId,
          isFirstScan,
          // Hashed, never stored raw: enough to spot a sticker being scraped
          // and mass-scanned, not enough to identify a passenger.
          ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
        },
      });
    }

    /**
     * The bus's route as it is today, not as it was when the sticker was printed: an
     * owner moving a bus to another road must not leave its QR showing the old one.
     * Only a seat sticker that was never tied to a bus falls back to its own route.
     */
    const route = qr.vehicle ? qr.vehicle.route : qr.route;
    const routeId = route?.id;
    // A trip the crew started says which way the bus is going; otherwise the traveller's tap does.
    const trip = qr.vehicle ? await this.trips.tripNow(qr.vehicle.id) : null;
    const tripDirection = trip?.direction ?? null;
    const direction = tripDirection ?? dto.direction ?? null;

    const [programme, notices, corridorBusinesses] = await Promise.all([
      this.programming.programmeFor({
        vehicleId: qr.vehicle?.id, operatorId: qr.operator?.id, routeId, direction,
      }),
      this.programming.noticesFor(routeId, direction),
      // Businesses that paid to target this corridor, highest tier first.
      routeId
        ? this.prisma.business.findMany({
            where: { isActive: true, routeTargets: { some: { routeId } } },
            orderBy: [{ tier: 'desc' }, { verifiedAt: 'desc' }],
            take: 8,
            select: {
              id: true, slug: true, name: true, category: true, tier: true, priceRange: true,
              district: true, latitude: true, longitude: true, verifiedAt: true,
              // Saved with the scan, so Call and WhatsApp work on the road with no signal.
              phone: true, whatsapp: true,
              photos: { take: 1, select: { url: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    // Nothing about a company is public until Batoma has verified it, including its name here.
    const verified = qr.operator?.verification === 'VERIFIED' && qr.operator.isActive;
    // A sticker on a verified company's bus also lets the passenger review that bus.
    // Signing a token is cheap enough for this path; the rating itself loads on the bus page.
    const reviewable = !!qr.vehicle?.isActive && verified;
    const bus = reviewable
      ? {
          id: qr.vehicle.id, registrationNo: qr.vehicle.plateNo, label: qr.vehicle.label,
          scanToken: await this.busReviews.issueScanToken({ qid: qr.id, vid: qr.vehicle.id }),
        }
      : null;

    const shelf = [programme.lead, ...programme.stories].filter(Boolean).map((p) => this.card(p));
    const more = programme.more.map((p) => this.card(p));

    return {
      scan: {
        qrCodeId: qr.id,
        seatNo: qr.seatNo,
        isFirstScan,
        scannedAt: new Date().toISOString(),
      },
      operator: verified ? { id: qr.operator.id, name: qr.operator.name, slug: qr.operator.slug, logoUrl: qr.operator.logoUrl } : null,
      vehicle: verified && qr.vehicle ? { id: qr.vehicle.id, plateNo: qr.vehicle.plateNo, label: qr.vehicle.label } : null,
      bus,
      route,
      direction,
      /** TRIP when the crew's duty log decided it, so the reader does not ask. */
      directionSource: tripDirection ? 'TRIP' : direction ? 'TRAVELLER' : null,
      // When the bus left, so the stops timeline knows what is behind and what is coming up.
      departedAt: trip?.departAt ?? null,
      currentIssue: programme.issue,
      /** The lead story first, then up to twelve more: this bus's shelf. */
      routeArticles: shelf,
      /** The rest of the programme, for "More from this issue". */
      moreArticles: more,
      notices,
      programme: { version: programme.version, leadLevel: programme.lead?.level ?? null },
      corridorBusinesses,
      offlinePack: await this.manifest([...shelf, ...more], programme.version),
      appLinks: this.appLinks(),
    };
  }

  private card(p: { article: ProgrammeCard; level: string; isPinned: boolean }) {
    const { updatedAt: _updatedAt, publishedAt: _publishedAt, ...article } = p.article;
    return { ...article, level: p.level, isLead: p.isPinned };
  }

  /** Base URL this API is reachable at from a phone, not from localhost. */
  private absolute(path: string): string {
    const base = (this.config.get<string>('API_PUBLIC_URL')
      ?? `http://localhost:${this.config.get('PORT') ?? 3000}`).replace(/\/$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private toAbsolute(url?: string | null): string | null {
    if (!url) return null;
    if (/^https?:\/\//i.test(url)) return url;
    return this.absolute(url);
  }

  /** The pack for a route with no bus: its programme for both directions. */
  async offlineManifest(routeId?: string) {
    const programme = await this.programming.programmeFor({ routeId });
    const articles = [programme.lead, ...programme.stories, ...programme.more].filter(Boolean).map((p) => p.article);
    return this.manifest(articles, programme.version);
  }

  /**
   * Everything the service worker should pre-cache at the bus park: exactly the
   * stories this bus is programmed to show. Sent on every resolve with the programme
   * version, so the client can tell whether what it holds is still current.
   */
  private async manifest(
    articles: Array<{ slug: string; audioUrl: string | null; coverImageUrl: string | null }>,
    version: string,
  ) {
    const prefix = this.config.get<string>('API_PREFIX') ?? 'api/v1';
    const mapPacks = await this.prisma.mapPack.findMany({
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, sizeBytes: true, downloadUrl: true, version: true },
    });

    return {
      generatedAt: new Date().toISOString(),
      programmeVersion: version,
      articleCount: articles.length,
      /**
       * Absolute URLs, deliberately.
       *
       * The service worker resolves whatever it is given against the page
       * origin. The API usually sits on a different host or port, so relative
       * paths silently cached 404s from the web origin and offline reading
       * quietly did nothing — while still reporting a healthy article count.
       */
      articles: articles.map((a) => ({
        url: this.absolute(`/${prefix}/magazine/articles/${a.slug}`),
        audioUrl: this.toAbsolute(a.audioUrl),
        imageUrl: this.toAbsolute(a.coverImageUrl),
      })),
      mapPacks: mapPacks.map((m) => ({ ...m, sizeBytes: m.sizeBytes.toString() })),
    };
  }

  /**
   * Store links plus the deferred-deep-link payload (Module 9, section 4.5).
   * The client shows the install banner only from the second session.
   */
  appLinks() {
    return {
      appStoreUrl: this.config.get('APP_STORE_URL'),
      playStoreUrl: this.config.get('PLAY_STORE_URL'),
      iosAppId: this.config.get('IOS_APP_ID'),
      androidPackage: this.config.get('ANDROID_PACKAGE'),
      minSupportedBuild: Number(this.config.get('MIN_SUPPORTED_APP_BUILD') ?? 1),
      /** Never prompt on the first scan — it destroys the funnel. */
      promptInstallFromSession: 2,
    };
  }

  // ---------- admin: minting stickers ----------

  async createBatch(dto: CreateQrBatchDto) {
    const rows = Array.from({ length: dto.count }, (_, i) => ({
      shortCode: shortCode(),
      operatorId: dto.operatorId,
      vehicleId: dto.vehicleId ?? null,
      routeId: dto.routeId ?? null,
      seatNo: dto.numberSeats ? String(i + 1) : null,
      placement: dto.placement ?? 'SEAT_BACK',
      printedAt: new Date(),
    }));

    await this.prisma.qrCode.createMany({ data: rows, skipDuplicates: true });

    const base = this.config.get('PUBLIC_WEB_URL');
    return {
      created: rows.length,
      codes: rows.map((r) => ({
        shortCode: r.shortCode,
        seatNo: r.seatNo,
        url: `${base}/r/${r.shortCode}`,
      })),
    };
  }

  async deactivate(id: string) {
    return this.prisma.qrCode.update({
      where: { id },
      data: { isActive: false, replacedAt: new Date() },
    });
  }

  /** Scan analytics: the Phase 0 metric that decides whether anything else matters. */
  async stats(params: { operatorId?: string; routeId?: string; days?: number }) {
    const since = new Date(Date.now() - (params.days ?? 30) * 86_400_000);
    const where = {
      scannedAt: { gte: since },
      qrCode: {
        ...(params.operatorId ? { operatorId: params.operatorId } : {}),
        ...(params.routeId ? { routeId: params.routeId } : {}),
      },
    };

    const [total, firstScans, distinctSessions, byRoute] = await Promise.all([
      this.prisma.scanEvent.count({ where }),
      this.prisma.scanEvent.count({ where: { ...where, isFirstScan: true } }),
      /**
       * COUNT(DISTINCT ...) in the database. The previous version pulled every
       * matching row into Node just to read .length, which is fine at a
       * thousand scans and ruinous at a million.
       */
      this.prisma.$queryRaw<Array<{ devices: bigint }>>`
        SELECT COUNT(DISTINCT se."sessionId")::bigint AS devices
          FROM scan_events se
          JOIN qr_codes q ON q.id = se."qrCodeId"
         WHERE se."scannedAt" >= ${since}
           AND (${params.operatorId ?? null}::text IS NULL OR q."operatorId" = ${params.operatorId ?? null}::text)
           AND (${params.routeId ?? null}::text IS NULL OR q."routeId" = ${params.routeId ?? null}::text)`,
      this.prisma.$queryRaw<Array<{ route: string; scans: bigint }>>`
        SELECT COALESCE(r.name, 'Unassigned') AS route, COUNT(*)::bigint AS scans
          FROM scan_events se
          JOIN qr_codes q ON q.id = se."qrCodeId"
     LEFT JOIN routes r ON r.id = q."routeId"
         WHERE se."scannedAt" >= ${since}
      GROUP BY r.name
      ORDER BY scans DESC`,
    ]);

    return {
      periodDays: params.days ?? 30,
      totalScans: total,
      firstTimeScans: firstScans,
      returningScans: total - firstScans,
      uniqueDevices: Number(distinctSessions[0]?.devices ?? 0),
      byRoute: byRoute.map((r) => ({ route: r.route, scans: Number(r.scans) })),
    };
  }
}
