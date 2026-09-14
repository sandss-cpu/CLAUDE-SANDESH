import { BadRequestException, Injectable } from '@nestjs/common';
import { ContentStatus, ModerationAct, ModerationStatus, ReportStatus, TargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateReportDto, ModerateDto } from './dto/moderation.dto';

/**
 * Trust & safety. The reporting, blocking and review path here is not
 * optional polish: Apple Guideline 1.2 requires all of it to be present
 * before a user-generated-content app will be accepted at all.
 */
@Injectable()
export class ModerationService {
  constructor(private prisma: PrismaService) {}

  report(dto: CreateReportDto, reporterId?: string) {
    return this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        reason: dto.reason,
        detail: dto.detail,
      },
    });
  }

  openReports(skip = 0, take = 50) {
    return this.prisma.report.findMany({
      where: { status: ReportStatus.OPEN },
      include: { reporter: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      skip, take,
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
      switch (dto.targetType) {
        case TargetType.POST: {
          if (dto.action === ModerationAct.DELETE) {
            await tx.post.delete({ where: { id: dto.targetId } });
            break;
          }
          await tx.post.update({
            where: { id: dto.targetId },
            data: {
              moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED,
              status: approved ? ContentStatus.PUBLISHED : ContentStatus.DRAFT,
              publishedAt: approved ? new Date() : null,
              moderationNote: dto.note,
            },
          });
          break;
        }
        case TargetType.COMMENT: {
          if (dto.action === ModerationAct.DELETE) {
            await tx.comment.delete({ where: { id: dto.targetId } });
            break;
          }
          await tx.comment.update({
            where: { id: dto.targetId },
            data: {
              moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED,
            },
          });
          break;
        }
        case TargetType.REVIEW: {
          await tx.review.update({
            where: { id: dto.targetId },
            data: {
              moderation: approved ? ModerationStatus.APPROVED : ModerationStatus.REJECTED,
            },
          });
          break;
        }
        case TargetType.BUSINESS: {
          await tx.business.update({
            where: { id: dto.targetId },
            data: { isActive: !rejected },
          });
          break;
        }
        case TargetType.ARTICLE: {
          await tx.article.update({
            where: { id: dto.targetId },
            data: { status: approved ? ContentStatus.PUBLISHED : ContentStatus.ARCHIVED },
          });
          break;
        }
        default:
          throw new BadRequestException('Unsupported moderation target');
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
    const [posts, comments, reviews, reports, oldest] = await Promise.all([
      this.prisma.post.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.comment.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.review.count({ where: { moderation: ModerationStatus.PENDING } }),
      this.prisma.report.count({ where: { status: ReportStatus.OPEN } }),
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
      oldestOpenReportHours: oldestHours,
      slaBreached: oldestHours > 24,
    };
  }
}
