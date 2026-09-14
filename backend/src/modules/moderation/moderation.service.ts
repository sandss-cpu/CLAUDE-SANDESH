import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentStatus, ModerationAct, ModerationStatus, ReportStatus, TargetType } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateReportDto, ModerateDto } from './dto/moderation.dto';

/** Distinct people whose open reports take a live vlog or comment out of public view. */
export const AUTO_HIDE_AT = 3;

const excerpt = (s?: string | null, max = 280) =>
  s && s.length > max ? `${s.slice(0, max - 3).trimEnd()}…` : s ?? '';

/**
 * Trust & safety. The reporting, blocking and review path here is not
 * optional polish: Apple Guideline 1.2 requires all of it to be present
 * before a user-generated-content app will be accepted at all.
 */
@Injectable()
export class ModerationService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  async report(dto: CreateReportDto, reporterId?: string, ip?: string) {
    if (!reporterId && !dto.sessionId) {
      throw new BadRequestException('Reload the page and try reporting again.');
    }
    await this.assertTargetExists(dto.targetType, dto.targetId);

    // One open report per person per item: repeat taps and double submits change nothing.
    const existing = await this.prisma.report.findFirst({
      where: {
        targetType: dto.targetType, targetId: dto.targetId, status: ReportStatus.OPEN,
        ...(reporterId ? { reporterId } : { reporterId: null, sessionId: dto.sessionId }),
      },
      select: { id: true },
    });
    if (existing) return { reported: true, duplicate: true, hidden: false };

    await this.prisma.report.create({
      data: {
        reporterId: reporterId ?? null,
        sessionId: reporterId ? null : dto.sessionId,
        ipHash: ip ? this.hashIp(ip) : null,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        detail: dto.detail?.trim() || null,
      },
    });

    const hidden = await this.autoHideIfNeeded(dto.targetType, dto.targetId);
    return { reported: true, duplicate: false, hidden };
  }

  /** Salted, so the stored value cannot be reversed into an address by anyone reading the table. */
  private hashIp(ip: string) {
    return createHash('sha256').update(`${ip}:${this.config.get<string>('JWT_SECRET')}`).digest('hex');
  }

  private async assertTargetExists(targetType: TargetType, id: string) {
    const select = { id: true } as const;
    const found =
      targetType === TargetType.POST ? await this.prisma.post.findUnique({ where: { id }, select })
      : targetType === TargetType.COMMENT ? await this.prisma.comment.findUnique({ where: { id }, select })
      : targetType === TargetType.ARTICLE ? await this.prisma.article.findUnique({ where: { id }, select })
      : targetType === TargetType.REVIEW ? await this.prisma.review.findUnique({ where: { id }, select })
      : targetType === TargetType.BUSINESS ? await this.prisma.business.findUnique({ where: { id }, select })
      : targetType === TargetType.USER ? await this.prisma.user.findUnique({ where: { id }, select })
      : null;
    if (!found) throw new NotFoundException('That content is no longer available.');
  }

  /**
   * A safety net between moderator visits. Counted in distinct people, not
   * rows: signed-in reporters by account, anonymous ones by network, so one
   * person opening many browser sessions cannot hide a post on their own.
   */
  private async autoHideIfNeeded(targetType: TargetType, targetId: string) {
    if (targetType !== TargetType.POST && targetType !== TargetType.COMMENT) return false;
    const open = await this.prisma.report.findMany({
      where: { targetType, targetId, status: ReportStatus.OPEN },
      select: { reporterId: true, ipHash: true, sessionId: true },
    });
    const people = new Set(open.map((r) => r.reporterId ?? `net:${r.ipHash ?? r.sessionId}`));
    if (people.size < AUTO_HIDE_AT) return false;

    const { count } = targetType === TargetType.POST
      ? await this.prisma.post.updateMany({
          where: { id: targetId, moderation: ModerationStatus.APPROVED },
          data: {
            moderation: ModerationStatus.PENDING,
            moderationNote: `Hidden automatically after reports from ${people.size} people`,
          },
        })
      : await this.prisma.comment.updateMany({
          where: { id: targetId, moderation: ModerationStatus.APPROVED },
          data: { moderation: ModerationStatus.PENDING },
        });
    return count > 0;
  }

  /**
   * Open reports grouped by what was reported, most-reported first, each with
   * enough of the content to decide without opening another tab. A null
   * preview means the content has already been removed.
   */
  async openReports(skip = 0, take = 50) {
    const rows = await this.prisma.report.findMany({
      where: { status: ReportStatus.OPEN },
      include: { reporter: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    type Group = {
      targetType: TargetType; targetId: string; count: number; reasons: Record<string, number>;
      details: Array<{ reason: string; detail: string; reporter: string; at: Date }>;
      firstReportedAt: Date; lastReportedAt: Date;
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = `${r.targetType}:${r.targetId}`;
      const g = groups.get(key) ?? {
        targetType: r.targetType, targetId: r.targetId, count: 0, reasons: {}, details: [],
        firstReportedAt: r.createdAt, lastReportedAt: r.createdAt,
      };
      g.count += 1;
      g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
      if (r.detail) {
        g.details.push({ reason: r.reason, detail: r.detail, reporter: r.reporter?.name ?? 'Anonymous reader', at: r.createdAt });
      }
      g.lastReportedAt = r.createdAt;
      groups.set(key, g);
    }

    const ordered = [...groups.values()]
      .sort((a, b) => b.count - a.count || a.firstReportedAt.getTime() - b.firstReportedAt.getTime())
      .slice(skip, skip + take);
    const ids = (type: TargetType) => ordered.filter((g) => g.targetType === type).map((g) => g.targetId);
    const person = { select: { id: true, name: true, isSuspended: true } } as const;

    const [posts, comments, articles, reviews, businesses, users] = await Promise.all([
      this.prisma.post.findMany({
        where: { id: { in: ids(TargetType.POST) } },
        select: { id: true, title: true, body: true, coverImageUrl: true, status: true, moderation: true, moderationNote: true, author: person },
      }),
      this.prisma.comment.findMany({
        where: { id: { in: ids(TargetType.COMMENT) } },
        select: { id: true, body: true, moderation: true, user: person },
      }),
      this.prisma.article.findMany({
        where: { id: { in: ids(TargetType.ARTICLE) } },
        select: { id: true, title: true, subtitle: true, status: true, coverImageUrl: true },
      }),
      this.prisma.review.findMany({
        where: { id: { in: ids(TargetType.REVIEW) } },
        select: { id: true, body: true, rating: true, moderation: true, user: person, business: { select: { name: true } } },
      }),
      this.prisma.business.findMany({
        where: { id: { in: ids(TargetType.BUSINESS) } },
        select: { id: true, name: true, description: true, isActive: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: ids(TargetType.USER) } },
        select: { id: true, name: true, bio: true, isSuspended: true },
      }),
    ]);

    return ordered.map((g) => {
      const find = <T extends { id: string }>(list: T[]) => list.find((x) => x.id === g.targetId);
      let preview: Record<string, unknown> | null = null;
      switch (g.targetType) {
        case TargetType.POST: {
          const p = find(posts);
          if (p) {
            preview = {
              kind: 'Traveller vlog', title: p.title, text: excerpt(p.body), imageUrl: p.coverImageUrl, author: p.author,
              visibility: p.status === ContentStatus.PUBLISHED && p.moderation === ModerationStatus.APPROVED ? 'Live'
                : p.moderation === ModerationStatus.PENDING ? 'Hidden until reviewed' : 'Not public',
              note: p.moderationNote,
            };
          }
          break;
        }
        case TargetType.COMMENT: {
          const c = find(comments);
          if (c) preview = { kind: 'Comment', text: excerpt(c.body), author: c.user, visibility: c.moderation === ModerationStatus.APPROVED ? 'Live' : 'Hidden until reviewed' };
          break;
        }
        case TargetType.ARTICLE: {
          const a = find(articles);
          if (a) preview = { kind: 'Magazine article', title: a.title, text: a.subtitle ?? '', imageUrl: a.coverImageUrl, visibility: a.status === ContentStatus.PUBLISHED ? 'Live' : 'Not public' };
          break;
        }
        case TargetType.REVIEW: {
          const r = find(reviews);
          if (r) preview = { kind: `Review of ${r.business.name}`, title: `${r.rating}★`, text: excerpt(r.body), author: r.user, visibility: r.moderation === ModerationStatus.APPROVED ? 'Live' : 'Hidden until reviewed' };
          break;
        }
        case TargetType.BUSINESS: {
          const b = find(businesses);
          if (b) preview = { kind: 'Business listing', title: b.name, text: excerpt(b.description), visibility: b.isActive ? 'Live' : 'Switched off' };
          break;
        }
        case TargetType.USER: {
          const u = find(users);
          if (u) preview = { kind: 'Traveller profile', title: u.name, text: excerpt(u.bio), author: u, visibility: u.isSuspended ? 'Suspended' : 'Active' };
          break;
        }
      }
      return { ...g, preview };
    });
  }

  /** Posts awaiting review. Nothing reaches the public feed unmoderated. */
  pendingPosts(skip = 0, take = 50) {
    return this.prisma.post.findMany({
      where: {
        moderation: ModerationStatus.PENDING,
        status: { in: [ContentStatus.IN_REVIEW, ContentStatus.PUBLISHED] },
      },
      include: {
        author: { select: { id: true, name: true, phone: true } },
        photos: { select: { url: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip, take,
    });
  }

  pendingComments(skip = 0, take = 50) {
    return this.prisma.comment.findMany({
      where: { moderation: ModerationStatus.PENDING },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      skip, take,
    });
  }

  pendingReviews(skip = 0, take = 50) {
    return this.prisma.review.findMany({
      where: { moderation: ModerationStatus.PENDING },
      include: {
        user: { select: { id: true, name: true } },
        business: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip, take,
    });
  }

  /** Every action is written to an append-only audit trail. */
  async act(dto: ModerateDto, moderatorId: string) {
    const approved = dto.action === ModerationAct.APPROVE;
    const rejected =
      dto.action === ModerationAct.REJECT ||
      dto.action === ModerationAct.HIDE ||
      dto.action === ModerationAct.DELETE;

    await this.prisma.$transaction(async (tx) => {
      // updateMany/deleteMany rather than update/delete: content removed elsewhere
      // must not roll the transaction back and leave its reports stuck open forever.
      switch (dto.targetType) {
        case TargetType.POST: {
          if (dto.action === ModerationAct.DELETE) {
            await tx.post.deleteMany({ where: { id: dto.targetId } });
            break;
          }
          const post = await tx.post.findUnique({ where: { id: dto.targetId }, select: { publishedAt: true } });
          if (!post) break;
          await tx.post.update({
            where: { id: dto.targetId },
            data: {
              moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED,
              status: approved ? ContentStatus.PUBLISHED : ContentStatus.DRAFT,
              // Keeping a reported post must not bump it to the top of a newest-first feed.
              publishedAt: approved ? post.publishedAt ?? new Date() : null,
              moderationNote: approved ? null : dto.note ?? null,
            },
          });
          break;
        }
        case TargetType.COMMENT: {
          if (dto.action === ModerationAct.DELETE) {
            await tx.comment.deleteMany({ where: { id: dto.targetId } });
            break;
          }
          await tx.comment.updateMany({
            where: { id: dto.targetId },
            data: { moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED },
          });
          break;
        }
        case TargetType.REVIEW: {
          await tx.review.updateMany({
            where: { id: dto.targetId },
            data: { moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED },
          });
          break;
        }
        case TargetType.BUSINESS: {
          // Dismissing a report must not switch back on a listing that was turned off for another reason.
          if (rejected) await tx.business.updateMany({ where: { id: dto.targetId }, data: { isActive: false } });
          break;
        }
        case TargetType.ARTICLE: {
          // Dismissing a report leaves an article as it was; approving here used to publish drafts.
          if (rejected) {
            await tx.article.updateMany({ where: { id: dto.targetId }, data: { status: ContentStatus.ARCHIVED } });
          }
          break;
        }
        case TargetType.USER: {
          if (rejected) {
            await tx.user.updateMany({ where: { id: dto.targetId }, data: { isSuspended: true, suspendedUntil: null } });
            await tx.refreshToken.updateMany({
              where: { userId: dto.targetId, revokedAt: null }, data: { revokedAt: new Date() },
            });
          }
          break;
        }
        default:
          throw new BadRequestException('This kind of content cannot be moderated here');
      }

      await tx.moderationEntry.create({
        data: {
          moderatorId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          action: dto.action,
          note: dto.note,
        },
      });

      // Close any open reports against the same target.
      await tx.report.updateMany({
        where: { targetType: dto.targetType, targetId: dto.targetId, status: ReportStatus.OPEN },
        data: { status: approved ? ReportStatus.DISMISSED : ReportStatus.ACTIONED },
      });
    });

    return { moderated: true, action: dto.action };
  }

  auditTrail(targetType: TargetType, targetId: string) {
    return this.prisma.moderationEntry.findMany({
      where: { targetType, targetId },
      include: { moderator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Queue health: the number the moderation SLA is measured against. */
  async queueStats() {
    const [posts, comments, reviews, reports, reportedItems, oldest] = await Promise.all([
      this.prisma.post.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.comment.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.review.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
      this.prisma.report.groupBy({ by: ['targetType', 'targetId'], where: { status: ReportStatus.OPEN } }),
      this.prisma.report.findFirst({
        where: { status: ReportStatus.OPEN },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    const oldestHours = oldest
      ? +((Date.now() - oldest.createdAt.getTime()) / 3_600_000).toFixed(1)
      : 0;

    return {
      pendingPosts: posts,
      pendingComments: comments,
      pendingReviews: reviews,
      openReports: reports,
      reportedItems: reportedItems.length,
      oldestOpenReportHours: oldestHours,
      slaBreached: oldestHours > 24,
    };
  }
}
