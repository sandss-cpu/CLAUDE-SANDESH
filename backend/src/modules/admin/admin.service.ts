import { Injectable } from '@nestjs/common';
import { BusinessTier, ContentStatus, ModerationStatus, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Audit actions shown as security events, by the filter they appear under. A trailing dot matches a prefix. */
export const SECURITY_KINDS: Record<string, string[]> = {
  signin: ['auth.failed', 'auth.locked', 'auth.new_device', 'auth.recovery_code', 'auth.password_reset', 'auth.logout_all'],
  accounts: ['user.role', 'user.reset_mfa', 'user.suspend', 'user.unsuspend', 'auth.mfa_enabled', 'auth.recovery_codes', 'account.delete'],
  exports: ['account.export', 'newsletter.export', 'income.export'],
  qr: ['qr.rotate'],
  finance: ['income.', 'finance.', 'trip.unlock'],
  verification: ['verification.', 'business.verify', 'business.tier'],
};

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  /**
   * The single screen an administrator opens first. Everything here is either
   * a number that decides whether the business is working, or a queue that
   * someone has to clear today.
   */
  async overview(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const soon = new Date(Date.now() + 14 * 86_400_000);

    const [
      scans, firstScans, devices, users, newUsers,
      publishedPosts, pendingPosts, pendingComments, pendingReviews, openReports,
      businesses, unverifiedBusinesses, expiringSoon,
      leads, couponsClaimed, couponsRedeemed, articles, oldestReport,
    ] = await Promise.all([
      this.prisma.scanEvent.count({ where: { scannedAt: { gte: since } } }),
      this.prisma.scanEvent.count({ where: { scannedAt: { gte: since }, isFirstScan: true } }),
      this.prisma.scanEvent.findMany({
        where: { scannedAt: { gte: since } }, distinct: ['sessionId'], select: { sessionId: true },
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.post.count({
        where: { status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED },
      }),
      this.prisma.post.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.comment.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.review.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
      this.prisma.business.count({ where: { isActive: true } }),
      this.prisma.business.count({ where: { verifiedAt: null, isActive: true } }),
      this.prisma.business.count({
        where: { tier: { not: BusinessTier.FREE }, subscriptionEndsAt: { lte: soon, gte: new Date() } },
      }),
      this.prisma.businessLead.count({ where: { createdAt: { gte: since } } }),
      this.prisma.couponRedemption.count({ where: { issuedAt: { gte: since } } }),
      this.prisma.couponRedemption.count({ where: { redeemedAt: { gte: since } } }),
      this.prisma.article.count({ where: { status: ContentStatus.PUBLISHED } }),
      this.prisma.report.findFirst({
        where: { status: ReportStatus.OPEN },
        orderBy: { createdAt: 'asc' }, select: { createdAt: true },
      }),
    ]);

    const oldestReportHours = oldestReport
      ? +((Date.now() - oldestReport.createdAt.getTime()) / 3_600_000).toFixed(1)
      : 0;

    return {
      periodDays: days,
      reach: {
        scans,
        firstTimeScans: firstScans,
        returningScans: scans - firstScans,
        uniqueDevices: devices.length,
        // The Phase 0 question: does anyone come back without a new sticker?
        returnRate: scans ? +(((scans - firstScans) / scans) * 100).toFixed(1) : 0,
      },
      audience: { totalUsers: users, newUsers, publishedPosts, publishedArticles: articles },
      queues: {
        pendingPosts, pendingComments, pendingReviews, openReports,
        unverifiedBusinesses,
        oldestOpenReportHours: oldestReportHours,
        slaBreached: oldestReportHours > 24,
        totalOutstanding:
          pendingPosts + pendingComments + pendingReviews + openReports + unverifiedBusinesses,
      },
      commercial: {
        activeBusinesses: businesses,
        subscriptionsExpiringIn14Days: expiringSoon,
        leads,
        couponsClaimed,
        couponsRedeemed,
        couponConversionRate: couponsClaimed
          ? +((couponsRedeemed / couponsClaimed) * 100).toFixed(1)
          : 0,
      },
    };
  }

  /** Paying listings and when they lapse — the renewal worklist. */
  async subscriptions() {
    const rows = await this.prisma.business.findMany({
      where: { tier: { not: BusinessTier.FREE } },
      select: {
        id: true, slug: true, name: true, tier: true, district: true,
        subscriptionEndsAt: true, verifiedAt: true,
        owner: { select: { id: true, name: true, phone: true } },
        _count: { select: { leads: true } },
      },
      orderBy: { subscriptionEndsAt: 'asc' },
    });

    const now = Date.now();
    return rows.map((b) => ({
      ...b,
      daysRemaining: b.subscriptionEndsAt
        ? Math.round((b.subscriptionEndsAt.getTime() - now) / 86_400_000)
        : null,
      lapsed: b.subscriptionEndsAt ? b.subscriptionEndsAt.getTime() < now : false,
    }));
  }

  /** Recent privileged actions across the platform. */
  /**
   * The security events view: sign-in failures and locks, new devices, account and role
   * changes, exports of personal or financial data, QR code rotations, finance edits and
   * looks at verification documents. Read from the one audit table.
   */
  async securityEvents(q: { kind?: string; page?: number }) {
    const actions = q.kind && SECURITY_KINDS[q.kind] ? SECURITY_KINDS[q.kind] : Object.values(SECURITY_KINDS).flat();
    const take = 50;
    const page = Math.max(1, Math.min(200, q.page ?? 1));
    const where = { OR: actions.map((a) => (a.endsWith('.') ? { action: { startsWith: a } } : { action: a })) };
    const [rows, total, last24h] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take,
        select: { id: true, action: true, entityType: true, entityId: true, summary: true, actorId: true, operatorId: true, createdAt: true, ipHash: true } }),
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.groupBy({
        by: ['action'], where: { ...where, createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: { action: true },
      }),
    ]);
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true, role: true } });
    const names = new Map(actors.map((a) => [a.id, a]));
    return {
      items: rows.map((r) => ({
        ...r, ipHash: undefined,
        // Enough of the address hash to see that two events came from the same place, and no more.
        from: r.ipHash ? r.ipHash.slice(0, 8) : null,
        actor: r.actorId ? names.get(r.actorId) ?? { id: r.actorId, name: 'Deleted account', role: null } : null,
        kind: Object.entries(SECURITY_KINDS).find(([, list]) => list.some((a) => (a.endsWith('.') ? r.action.startsWith(a) : r.action === a)))?.[0] ?? 'other',
      })),
      total, page, pages: Math.max(1, Math.ceil(total / take)),
      last24h: Object.fromEntries(last24h.map((g) => [g.action, g._count.action])),
    };
  }

  auditLog(skip = 0, take = 100) {
    return this.prisma.moderationEntry.findMany({
      include: { moderator: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip, take,
    });
  }
}
