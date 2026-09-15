import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ModerationStatus, OperatorVerification, Prisma, QrKind, TargetType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { needsReview } from '../../common/utils/content-filter';
import { ModerationService } from '../moderation/moderation.service';
import { FleetAccessService, parseDate } from './fleet-access.service';
import { ownerReviewView } from './fleet.service';
import { OwnerReportDto, ReviewListQueryDto, SubmitReviewDto } from './dto/fleet.dto';
import { DAY_MS, normalisePlate, round1, topWords } from './fleet.util';

const SCAN_SCOPE = 'bus-review';
/** Long enough to review after getting off at the end of an overnight route. */
const SCAN_TOKEN_TTL = '12h';
const REPEAT_WINDOW_MS = 20 * 3_600_000;
/**
 * Nepali mobile networks put many passengers behind one address (carrier NAT),
 * so this is a generous ceiling against scripted abuse, not a per-person limit.
 */
const MAX_ANONYMOUS_PER_NETWORK_PER_BUS = 25;

interface ScanClaims { sub: string; scope: string; vid?: string; oid?: string }

const excerpt = (s: string | null | undefined, max = 160) =>
  !s ? '' : s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

const publicReview = (r: {
  id: string; overall: number; cleanliness: number | null; driving: number | null; punctuality: number | null;
  staff: number | null; comment: string | null; tripDate: Date | null; createdAt: Date; qrCodeId: string | null;
  ownerReply: string | null; ownerRepliedAt: Date | null;
}) => ({
  id: r.id, overall: r.overall, cleanliness: r.cleanliness, driving: r.driving, punctuality: r.punctuality,
  staff: r.staff, comment: r.comment, tripDate: r.tripDate, createdAt: r.createdAt,
  verifiedRide: !!r.qrCodeId, ownerReply: r.ownerReply, ownerRepliedAt: r.ownerRepliedAt,
});

/**
 * Passenger reviews. A review needs proof of being on the bus (a fresh QR scan)
 * or a confirmed account, so a competitor can't flood a bus with one-star
 * reviews from a script. The owner reads every word but never who wrote it.
 */
@Injectable()
export class BusReviewsService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private moderation: ModerationService,
    private access: FleetAccessService,
  ) {}

  private hashIp(ip: string) {
    return createHash('sha256').update(`${ip}:${this.config.get<string>('JWT_SECRET')}`).digest('hex');
  }

  /** Nothing about a bus is public until its company is verified. */
  private async publicBus(id: string) {
    const bus = await this.prisma.vehicle.findFirst({
      where: { id, isActive: true, operator: { verification: OperatorVerification.VERIFIED, isActive: true } },
      include: {
        operator: { select: { id: true, name: true, slug: true, logoUrl: true, contactPhone: true } },
        route: { select: { id: true, code: true, name: true, startPlace: true, endPlace: true } },
      },
    });
    if (!bus) throw new NotFoundException('This bus is not on Bato, or its profile is not public yet.');
    return bus;
  }

  /**
   * Signed with the API secret and scoped, so JwtStrategy refuses it as a session.
   * A bus code binds it to that bus; a company code to that company's buses.
   */
  issueScanToken(claims: { qid: string; vid?: string; oid?: string }) {
    return this.jwt.signAsync(
      { sub: claims.qid, scope: SCAN_SCOPE, vid: claims.vid, oid: claims.oid },
      { expiresIn: SCAN_TOKEN_TTL },
    );
  }

  private async readScanToken(token: string): Promise<ScanClaims | null> {
    try {
      const claims = await this.jwt.verifyAsync<ScanClaims>(token);
      return claims.scope === SCAN_SCOPE ? claims : null;
    } catch {
      return null;
    }
  }

  async scan(rawCode: string, sessionId?: string, ip?: string) {
    const code = rawCode.trim().toUpperCase();
    const qr = await this.prisma.qrCode.findUnique({
      where: { shortCode: code },
      include: {
        operator: { select: { id: true, verification: true, isActive: true } },
        vehicle: { select: { id: true, isActive: true } },
      },
    });
    const inactive = new NotFoundException(
      'This QR code is not active. Ask the crew, or search for the bus by its registration number.',
    );
    if (!qr?.isActive || !qr.operator || qr.operator.verification !== OperatorVerification.VERIFIED || !qr.operator.isActive) {
      throw inactive;
    }
    if (qr.kind !== QrKind.COMPANY && !qr.vehicle?.isActive) throw inactive;

    if (sessionId) {
      const seen = await this.prisma.scanEvent.findFirst({ where: { sessionId }, select: { id: true } });
      await this.prisma.scanEvent.create({
        data: {
          qrCodeId: qr.id, sessionId, isFirstScan: !seen,
          ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null,
        },
      });
    }

    if (qr.kind === QrKind.COMPANY) {
      return {
        kind: 'COMPANY' as const,
        company: await this.companyProfile(qr.operator.id),
        scanToken: await this.issueScanToken({ qid: qr.id, oid: qr.operator.id }),
      };
    }
    return {
      kind: 'BUS' as const,
      bus: await this.profile(qr.vehicle.id),
      scanToken: await this.issueScanToken({ qid: qr.id, vid: qr.vehicle.id }),
    };
  }

  async profile(id: string) {
    const bus = await this.publicBus(id);
    const where = { vehicleId: id, moderation: ModerationStatus.APPROVED };
    const [agg, distribution, satisfied, reviews] = await Promise.all([
      this.prisma.rideFeedback.aggregate({
        where, _count: { _all: true },
        _avg: { overall: true, cleanliness: true, driving: true, punctuality: true, staff: true },
      }),
      this.prisma.rideFeedback.groupBy({ by: ['overall'], where, _count: { _all: true } }),
      this.prisma.rideFeedback.count({ where: { ...where, overall: { gte: 4 } } }),
      this.reviewPage(id, 1),
    ]);
    const total = agg._count._all;
    return {
      id: bus.id, registrationNo: bus.plateNo, label: bus.label, busType: bus.busType, amenities: bus.amenities,
      seatCount: bus.seatCount, photoUrl: bus.photoUrl, make: bus.make, model: bus.model, year: bus.year,
      colour: bus.colour, status: bus.status,
      company: { id: bus.operator.id, name: bus.operator.name, slug: bus.operator.slug, logoUrl: bus.operator.logoUrl, verified: true },
      route: bus.route,
      rating: {
        average: round1(agg._avg.overall), reviews: total,
        satisfiedPercent: total ? Math.round((satisfied / total) * 100) : null,
        distribution: [5, 4, 3, 2, 1].map((stars) => ({
          stars, count: distribution.find((d) => d.overall === stars)?._count._all ?? 0,
        })),
        parts: {
          cleanliness: round1(agg._avg.cleanliness), driving: round1(agg._avg.driving),
          punctuality: round1(agg._avg.punctuality), staff: round1(agg._avg.staff),
        },
      },
      reviews,
    };
  }

  async reviewPage(vehicleId: string, page = 1) {
    const take = 10;
    const where = { vehicleId, moderation: ModerationStatus.APPROVED };
    const [total, rows] = await Promise.all([
      this.prisma.rideFeedback.count({ where }),
      this.prisma.rideFeedback.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (Math.max(1, page) - 1) * take, take,
      }),
    ]);
    return { items: rows.map(publicReview), meta: { total, page, pages: Math.max(1, Math.ceil(total / take)) } };
  }

  async publicReviews(vehicleId: string, page = 1) {
    await this.publicBus(vehicleId);
    return this.reviewPage(vehicleId, page);
  }

  /** Search by registration number, bus name or company, so a QR code is never the only way in. */
  async search(raw?: string) {
    const text = (raw ?? '').trim().slice(0, 60);
    if (text.length < 2) return [];
    const key = normalisePlate(text);
    const buses = await this.prisma.vehicle.findMany({
      where: {
        isActive: true,
        operator: { verification: OperatorVerification.VERIFIED, isActive: true },
        OR: [
          ...(key.length >= 2 ? [{ plateKey: { contains: key } }] : []),
          { label: { contains: text, mode: 'insensitive' as const } },
          { operator: { name: { contains: text, mode: 'insensitive' as const } } },
        ],
      },
      orderBy: { plateKey: 'asc' },
      take: 20,
      select: {
        id: true, plateNo: true, label: true, busType: true, photoUrl: true,
        operator: { select: { name: true } }, route: { select: { name: true } },
      },
    });
    return this.withRatings(buses);
  }

  private async withRatings<T extends { id: string; plateNo: string; label: string | null; operator?: { name: string }; route?: { name: string } | null }>(buses: T[]) {
    if (!buses.length) return [];
    const ratings = await this.prisma.rideFeedback.groupBy({
      by: ['vehicleId'],
      where: { vehicleId: { in: buses.map((b) => b.id) }, moderation: ModerationStatus.APPROVED },
      _avg: { overall: true }, _count: { _all: true },
    });
    return buses.map((b) => {
      const r = ratings.find((x) => x.vehicleId === b.id);
      const { plateNo, ...rest } = b;
      return { ...rest, registrationNo: plateNo, company: b.operator?.name, route: b.route?.name ?? null,
        rating: { average: round1(r?._avg.overall), reviews: r?._count._all ?? 0 } };
    });
  }

  async companyProfile(idOrSlug: string) {
    const operator = await this.prisma.operator.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }],
        verification: OperatorVerification.VERIFIED, isActive: true,
      },
      select: { id: true, name: true, slug: true, logoUrl: true, description: true, contactPhone: true, address: true },
    });
    if (!operator) throw new NotFoundException('This company is not on Bato, or its profile is not public yet.');
    const buses = await this.prisma.vehicle.findMany({
      where: { operatorId: operator.id, isActive: true },
      orderBy: { plateKey: 'asc' },
      take: 500,
      select: { id: true, plateNo: true, label: true, busType: true, photoUrl: true, route: { select: { name: true } } },
    });
    const rated = await this.withRatings(buses);
    const reviewed = rated.filter((b) => b.rating.reviews);
    const reviews = reviewed.reduce((n, b) => n + b.rating.reviews, 0);
    return {
      ...operator, verified: true, busCount: buses.length,
      rating: {
        reviews,
        average: reviews ? round1(reviewed.reduce((n, b) => n + b.rating.average * b.rating.reviews, 0) / reviews) : null,
      },
      buses: rated,
    };
  }

  async submit(busId: string, dto: SubmitReviewDto, user?: AuthUser, ip?: string) {
    const bus = await this.publicBus(busId);

    let qrCodeId: string | null = null;
    if (dto.scanToken) {
      const claims = await this.readScanToken(dto.scanToken);
      const matches = claims && (claims.vid ? claims.vid === busId : claims.oid === bus.operatorId);
      if (!matches) {
        throw new BadRequestException({
          code: 'SCAN_EXPIRED',
          message: 'Your scan has expired or belongs to another bus. Scan the QR code again, or sign in to review.',
        });
      }
      qrCodeId = claims.sub;
    }

    let userId: string | null = null;
    if (user) {
      const account = await this.prisma.user.findUnique({
        where: { id: user.id }, select: { emailVerifiedAt: true, isPhoneVerified: true },
      });
      if (account?.emailVerifiedAt || account?.isPhoneVerified) userId = user.id;
    }
    if (!qrCodeId && !userId) {
      throw new ForbiddenException({ code: 'SCAN_OR_SIGN_IN', message: 'Scan the QR code on the bus, or sign in, to review it.' });
    }
    if (!userId && !dto.sessionId) throw new BadRequestException('Reload the page and try again.');

    const since = new Date(Date.now() - REPEAT_WINDOW_MS);
    const repeat = await this.prisma.rideFeedback.findFirst({
      where: {
        vehicleId: busId, createdAt: { gte: since },
        OR: [...(userId ? [{ userId }] : []), ...(dto.sessionId ? [{ sessionId: dto.sessionId }] : [])],
      },
      select: { id: true },
    });
    if (repeat) {
      throw new ConflictException({ code: 'ALREADY_REVIEWED', message: 'You have already reviewed this bus today. Thank you!' });
    }

    const ipHash = ip ? this.hashIp(ip) : null;
    if (ipHash && !userId) {
      const fromNetwork = await this.prisma.rideFeedback.count({
        where: { vehicleId: busId, ipHash, userId: null, createdAt: { gte: since } },
      });
      if (fromNetwork >= MAX_ANONYMOUS_PER_NETWORK_PER_BUS) {
        throw new HttpException('Too many reviews for this bus from your network today. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    const tripDate = parseDate(dto.tripDate, 'The travel date', 1);
    if (tripDate && tripDate.getTime() < Date.now() - 366 * DAY_MS) {
      throw new BadRequestException('Reviews are for trips in the last year.');
    }

    const held = needsReview(dto.comment, dto.suggestion);
    const review = await this.prisma.rideFeedback.create({
      data: {
        vehicleId: busId, routeId: bus.routeId, sessionId: dto.sessionId ?? null, userId, ipHash, qrCodeId,
        overall: dto.overall, cleanliness: dto.cleanliness, driving: dto.driving, punctuality: dto.punctuality,
        staff: dto.staff, comment: dto.comment, suggestion: dto.suggestion, tripDate,
        moderation: held ? ModerationStatus.PENDING : ModerationStatus.APPROVED,
      },
    });

    if (!held && dto.overall <= 2) {
      await this.prisma.fleetNotification.create({
        data: {
          operatorId: bus.operatorId, vehicleId: busId, kind: 'LOW_RATING',
          title: `${dto.overall}★ review for ${bus.plateNo}`,
          body: excerpt(dto.comment || dto.suggestion) || 'No comment was left.',
          dedupeKey: `review:${review.id}`,
        },
      });
    }

    return {
      id: review.id, published: !held, verifiedRide: !!qrCodeId,
      message: held ? 'Thank you. Your review will appear after a quick check.' : 'Thank you. Your review is live.',
    };
  }

  // ================= owner side =================

  async ownerReviews(operatorId: string, q: ReviewListQueryDto, userId: string) {
    await this.access.company(operatorId, userId);
    const page = q.page ?? 1;
    const take = 20;
    const since = q.days ? new Date(Date.now() - q.days * DAY_MS) : null;
    const base: Prisma.RideFeedbackWhereInput = {
      vehicle: { operatorId },
      ...(q.busId ? { vehicleId: q.busId } : {}),
      ...(since ? { createdAt: { gte: since } } : {}),
    };
    const listWhere = { ...base, ...(q.rating ? { overall: q.rating } : {}) };
    const approved = { ...base, moderation: ModerationStatus.APPROVED };
    const sinceTrend = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1));

    const [total, rows, agg, distribution, satisfied, perBus, texts, suggestions, trend] = await Promise.all([
      this.prisma.rideFeedback.count({ where: listWhere }),
      this.prisma.rideFeedback.findMany({
        where: listWhere, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take,
        include: { vehicle: { select: { id: true, plateNo: true, label: true } } },
      }),
      this.prisma.rideFeedback.aggregate({
        where: approved, _count: { _all: true },
        _avg: { overall: true, cleanliness: true, driving: true, punctuality: true, staff: true },
      }),
      this.prisma.rideFeedback.groupBy({ by: ['overall'], where: approved, _count: { _all: true } }),
      this.prisma.rideFeedback.count({ where: { ...approved, overall: { gte: 4 } } }),
      this.prisma.rideFeedback.groupBy({
        by: ['vehicleId'], where: approved, _avg: { overall: true }, _count: { _all: true },
      }),
      this.prisma.rideFeedback.findMany({
        where: approved, orderBy: { createdAt: 'desc' }, take: 500, select: { comment: true, suggestion: true, overall: true },
      }),
      this.prisma.rideFeedback.findMany({
        where: { ...approved, suggestion: { not: null } }, orderBy: { createdAt: 'desc' }, take: 8,
        include: { vehicle: { select: { id: true, plateNo: true, label: true } } },
      }),
      this.prisma.$queryRaw<Array<{ month: Date; average: number; reviews: number }>>`
        SELECT date_trunc('month', rf."createdAt") AS month, AVG(rf.overall)::float AS average, COUNT(*)::int AS reviews
          FROM ride_feedback rf
          JOIN vehicles v ON v.id = rf."vehicleId"
         WHERE v."operatorId" = ${operatorId}
           AND (${q.busId ?? null}::text IS NULL OR rf."vehicleId" = ${q.busId ?? null}::text)
           AND rf.moderation = 'APPROVED' AND rf."createdAt" >= ${sinceTrend}
      GROUP BY 1 ORDER BY 1`,
    ]);

    const plates = await this.prisma.vehicle.findMany({
      where: { id: { in: perBus.map((p) => p.vehicleId) } }, select: { id: true, plateNo: true, label: true },
    });
    const reviewCount = agg._count._all;

    return {
      analytics: {
        reviews: reviewCount,
        average: round1(agg._avg.overall),
        satisfiedPercent: reviewCount ? Math.round((satisfied / reviewCount) * 100) : null,
        parts: {
          cleanliness: round1(agg._avg.cleanliness), driving: round1(agg._avg.driving),
          punctuality: round1(agg._avg.punctuality), staff: round1(agg._avg.staff),
        },
        distribution: [5, 4, 3, 2, 1].map((stars) => ({
          stars, count: distribution.find((d) => d.overall === stars)?._count._all ?? 0,
        })),
        trend: trend.map((t) => ({ month: t.month, average: round1(t.average), reviews: t.reviews })),
        byBus: perBus
          .map((p) => {
            const bus = plates.find((b) => b.id === p.vehicleId);
            return { busId: p.vehicleId, registrationNo: bus?.plateNo, label: bus?.label, average: round1(p._avg.overall), reviews: p._count._all };
          })
          .sort((a, b) => (a.average ?? 0) - (b.average ?? 0)),
        praise: topWords(texts.filter((t) => t.overall >= 4).map((t) => t.comment)),
        complaints: topWords(texts.filter((t) => t.overall <= 2).flatMap((t) => [t.comment, t.suggestion])),
        latestSuggestions: suggestions.map(ownerReviewView),
      },
      items: rows.map(ownerReviewView),
      meta: { total, page, pages: Math.max(1, Math.ceil(total / take)) },
    };
  }

  private async reviewForMember(reviewId: string, userId: string, level: 'VIEW' | 'MANAGE') {
    const review = await this.prisma.rideFeedback.findUnique({
      where: { id: reviewId },
      include: { vehicle: { select: { id: true, plateNo: true, label: true, operatorId: true } } },
    });
    if (!review?.vehicle) throw new NotFoundException('Review not found');
    await this.access.company(review.vehicle.operatorId, userId, level);
    return review;
  }

  /** A public reply under the review. Polite, because every passenger can read it. */
  async reply(reviewId: string, reply: string, userId: string) {
    await this.reviewForMember(reviewId, userId, 'MANAGE');
    if (reply && needsReview(reply)) {
      throw new BadRequestException('Replies are public, so please keep them polite. This one contains words Bato does not allow.');
    }
    const updated = await this.prisma.rideFeedback.update({
      where: { id: reviewId },
      data: { ownerReply: reply || null, ownerRepliedAt: reply ? new Date() : null },
      include: { vehicle: { select: { id: true, plateNo: true, label: true } } },
    });
    return ownerReviewView(updated);
  }

  /** Owners can't delete reviews; they report them, and a Bato moderator decides. */
  async report(reviewId: string, dto: OwnerReportDto, userId: string, ip?: string) {
    await this.reviewForMember(reviewId, userId, 'VIEW');
    return this.moderation.report(
      { targetType: TargetType.BUS_REVIEW, targetId: reviewId, reason: dto.reason, detail: dto.detail },
      userId, ip,
    );
  }
}
