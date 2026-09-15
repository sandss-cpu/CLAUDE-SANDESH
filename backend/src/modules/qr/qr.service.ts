import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ContentStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { shortCode } from '../../common/utils/slug.util';
import { CreateQrBatchDto } from './dto/qr.dto';
import { BusReviewsService } from '../fleet/bus-reviews.service';

@Injectable()
export class QrService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private busReviews: BusReviewsService,
  ) {}

  /**
   * The heart of the product: a sticker scan resolves to route-aware content.
   *
   * Returns the operator branding, the corridor's articles, the businesses
   * targeting that corridor, and the offline pack manifest the PWA should
   * cache immediately while the bus still has signal at the park.
   */
  async resolve(code: string, sessionId?: string, ip?: string) {
    const qr = await this.prisma.qrCode.findUnique({
      where: { shortCode: code },
      include: {
        operator: { select: { id: true, name: true, slug: true, logoUrl: true, verification: true, isActive: true } },
        route: true,
        vehicle: { select: { id: true, plateNo: true, label: true, isActive: true } },
      },
    });
    if (!qr || !qr.isActive) throw new NotFoundException('This code is not active');

    // Record the scan. First-scan detection drives the funnel metric in Phase 0.
    // findFirst + index beats count(): we only need existence, not a total,
    // and this runs on every scan against a table that only ever grows.
    let isFirstScan = true;
    if (sessionId) {
      const seen = await this.prisma.scanEvent.findFirst({
        where: { sessionId }, select: { id: true },
      });
      isFirstScan = !seen;
      await this.prisma.scanEvent.create({
        data: {
          qrCodeId: qr.id,
          sessionId,
          isFirstScan,
          // Hashed, never stored raw: enough to spot a sticker being scraped
          // and mass-scanned, not enough to identify a passenger.
          ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
        },
      });
    }

    const currentIssue = await this.prisma.issue.findFirst({
      where: { status: ContentStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      select: { id: true, number: true, title: true, strapline: true, coverImageUrl: true },
    });

    const routeId = qr.routeId ?? undefined;

    const routeArticles = routeId
      ? await this.prisma.article.findMany({
          where: {
            status: ContentStatus.PUBLISHED,
            routeLinks: { some: { routeId } },
          },
          orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
          take: 12,
          select: {
            id: true, slug: true, title: true, subtitle: true, coverImageUrl: true,
            readMinutes: true, audioUrl: true, isSponsored: true,
            category: { select: { slug: true, name: true, colorHex: true } },
          },
        })
      : [];

    // Businesses that paid to target this corridor, highest tier first.
    const corridorBusinesses = routeId
      ? await this.prisma.business.findMany({
          where: { isActive: true, routeTargets: { some: { routeId } } },
          orderBy: [{ tier: 'desc' }, { verifiedAt: 'desc' }],
          take: 8,
          select: {
            id: true, slug: true, name: true, category: true, tier: true,
            district: true, latitude: true, longitude: true, verifiedAt: true,
            photos: { take: 1, select: { url: true } },
          },
        })
      : [];

    // A seat sticker on a verified company's bus also lets the passenger review that bus.
    // Signing a token is cheap enough for this path; the rating itself loads on the bus page.
    const reviewable = !!qr.vehicle?.isActive && qr.operator?.verification === 'VERIFIED' && qr.operator.isActive;
    const bus = reviewable
      ? {
          id: qr.vehicle.id, registrationNo: qr.vehicle.plateNo, label: qr.vehicle.label,
          scanToken: await this.busReviews.issueScanToken({ qid: qr.id, vid: qr.vehicle.id }),
        }
      : null;

    return {
      scan: {
        qrCodeId: qr.id,
        seatNo: qr.seatNo,
        isFirstScan,
        scannedAt: new Date().toISOString(),
      },
      operator: qr.operator && { id: qr.operator.id, name: qr.operator.name, slug: qr.operator.slug, logoUrl: qr.operator.logoUrl },
      vehicle: qr.vehicle && { id: qr.vehicle.id, plateNo: qr.vehicle.plateNo, label: qr.vehicle.label },
      bus,
      route: qr.route,
      currentIssue,
      routeArticles,
      corridorBusinesses,
      offlinePack: await this.offlineManifest(routeId),
      appLinks: this.appLinks(),
    };
  }

  /**
   * Everything the service worker should pre-cache at the bus park.
   * Sent on every resolve so the client can diff against what it holds.
   */
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

  async offlineManifest(routeId?: string) {
    const prefix = this.config.get<string>('API_PREFIX') ?? 'api/v1';
    const articles = await this.prisma.article.findMany({
      where: {
        status: ContentStatus.PUBLISHED,
        ...(routeId ? { routeLinks: { some: { routeId } } } : {}),
      },
      orderBy: { publishedAt: 'desc' },
      take: 60,
      select: { slug: true, updatedAt: true, audioUrl: true, coverImageUrl: true },
    });

    const mapPacks = await this.prisma.mapPack.findMany({
      orderBy: { name: 'asc' },
      select: { slug: true, name: true, sizeBytes: true, downloadUrl: true, version: true },
    });

    return {
      generatedAt: new Date().toISOString(),
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
        version: a.updatedAt,
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
           AND (${params.operatorId ?? null}::uuid IS NULL OR q."operatorId" = ${params.operatorId ?? null}::uuid)
           AND (${params.routeId ?? null}::uuid IS NULL OR q."routeId" = ${params.routeId ?? null}::uuid)`,
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
