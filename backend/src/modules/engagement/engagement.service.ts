import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ModerationStatus, Role, TargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BookmarkDto, CommentDto, ReactDto } from './dto/engagement.dto';
import { needsReview } from '../../common/utils/content-filter';

@Injectable()
export class EngagementService {
  constructor(private prisma: PrismaService) {}

  // ---------- reactions ----------

  async react(dto: ReactDto, userId: string) {
    const existing = await this.prisma.reaction.findUnique({
      where: {
        userId_targetType_targetId: {
          userId, targetType: dto.targetType, targetId: dto.targetId,
        },
      },
    });

    // Same reaction again toggles it off.
    if (existing && (!dto.type || existing.type === dto.type)) {
      await this.prisma.reaction.delete({ where: { id: existing.id } });
      return { reacted: false };
    }

    await this.prisma.reaction.upsert({
      where: {
        userId_targetType_targetId: {
          userId, targetType: dto.targetType, targetId: dto.targetId,
        },
      },
      create: { userId, targetType: dto.targetType, targetId: dto.targetId, type: dto.type ?? 'LIKE' },
      update: { type: dto.type ?? 'LIKE' },
    });
    return { reacted: true, type: dto.type ?? 'LIKE' };
  }

  counts(targetType: TargetType, targetId: string) {
    return this.prisma.reaction.groupBy({
      by: ['type'],
      where: { targetType, targetId },
      _count: { type: true },
    });
  }

  // ---------- bookmarks ----------

  async bookmark(dto: BookmarkDto, userId: string) {
    const existing = await this.prisma.bookmark.findUnique({
      where: {
        userId_targetType_targetId: {
          userId, targetType: dto.targetType, targetId: dto.targetId,
        },
      },
    });
    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await this.prisma.bookmark.create({
      data: { userId, targetType: dto.targetType, targetId: dto.targetId },
    });
    return { saved: true };
  }

  /** The reading list, resolved to real records so it can be cached offline. */
  async myBookmarks(userId: string) {
    const marks = await this.prisma.bookmark.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
    });

    const articleIds = marks.filter((m) => m.targetType === 'ARTICLE').map((m) => m.targetId);
    const postIds = marks.filter((m) => m.targetType === 'POST').map((m) => m.targetId);
    const businessIds = marks.filter((m) => m.targetType === 'BUSINESS').map((m) => m.targetId);

    const [articles, posts, businesses] = await Promise.all([
      articleIds.length
        ? this.prisma.article.findMany({
            where: { id: { in: articleIds } },
            select: {
              id: true, slug: true, title: true, coverImageUrl: true,
              readMinutes: true, audioUrl: true,
            },
          })
        : [],
      postIds.length
        ? this.prisma.post.findMany({
            where: { id: { in: postIds } },
            select: { id: true, title: true, coverImageUrl: true, locationName: true },
          })
        : [],
      businessIds.length
        ? this.prisma.business.findMany({
            where: { id: { in: businessIds } },
            select: { id: true, slug: true, name: true, category: true, district: true },
          })
        : [],
    ]);

    return { articles, posts, businesses, total: marks.length };
  }

  // ---------- comments ----------

  async comment(dto: CommentDto, userId: string) {
    const suspicious = needsReview(dto.body);

    return this.prisma.comment.create({
      data: {
        userId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        parentId: dto.parentId,
        body: dto.body,
        moderation: suspicious ? ModerationStatus.PENDING : ModerationStatus.APPROVED,
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
  }

  listComments(targetType: TargetType, targetId: string) {
    return this.prisma.comment.findMany({
      where: { targetType, targetId, parentId: null, moderation: ModerationStatus.APPROVED },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        replies: {
          where: { moderation: ModerationStatus.APPROVED },
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async deleteComment(id: string, userId: string, role: Role) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    const privileged = role === Role.ADMIN || role === Role.MODERATOR;
    if (comment.userId !== userId && !privileged) {
      throw new ForbiddenException('This is not your comment');
    }
    await this.prisma.comment.delete({ where: { id } });
    return { deleted: true };
  }
}
