import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentStatus, ModerationStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paged } from '../../common/dto/pagination.dto';
import { fuzzCoords } from '../../common/utils/geo.util';
import { needsReview } from '../../common/utils/content-filter';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import { CreatePostDto, PostQueryDto, UpdatePostDto } from './dto/post.dto';

const POST_CARD = {
  id: true, title: true, coverImageUrl: true, locationName: true, template: true,
  publishedAt: true, createdAt: true, isElevated: true, body: true,
  author: {
    select: {
      id: true, name: true, avatarUrl: true, homeDistrict: true,
      // So a vlog card can link to its writer's creator profile when they have one.
      creatorProfile: { select: { handle: true, displayName: true, status: true } },
    },
  },
  destination: { select: { slug: true, name: true, district: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.PostSelect;

@Injectable()
export class PostsService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  /** A traveller post may only show images that were uploaded through /media/upload. */
  private assertOwnMedia(dto: CreatePostDto | UpdatePostDto) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    const urls = [dto.coverImageUrl, ...(dto.photos ?? []).map((p) => p.url)].filter(Boolean);
    if (urls.some((u) => !isOwnMediaUrl(u, base))) {
      throw new BadRequestException('Photos must be uploaded through Bato.');
    }
  }

  /** Up/down counts for a set of posts, plus the viewer's own vote. Two queries total. */
  private async withVotes<T extends { id: string }>(posts: T[], viewerId?: string) {
    if (!posts.length) return [] as Array<T & { upvotes: number; downvotes: number; myVote: number }>;
    const ids = posts.map((p) => p.id);
    const [grouped, mine] = await Promise.all([
      this.prisma.postVote.groupBy({
        by: ['postId', 'value'], where: { postId: { in: ids } }, _count: { _all: true },
      }),
      viewerId
        ? this.prisma.postVote.findMany({
            where: { userId: viewerId, postId: { in: ids } }, select: { postId: true, value: true },
          })
        : Promise.resolve([] as Array<{ postId: string; value: number }>),
    ]);
    const count = (postId: string, value: number) =>
      grouped.find((g) => g.postId === postId && g.value === value)?._count._all ?? 0;

    return posts.map((p) => ({
      ...p,
      upvotes: count(p.id, 1),
      downvotes: count(p.id, -1),
      myVote: mine.find((m) => m.postId === p.id)?.value ?? 0,
    }));
  }

  /** Feed cards carry a short excerpt, never the full body, plus vote counts. */
  private async toCards<T extends { id: string; body?: string }>(posts: T[], viewerId?: string) {
    const voted = await this.withVotes(posts, viewerId);
    return voted.map(({ body, ...p }) => ({
      ...p,
      excerpt: body && body.length > 220 ? `${body.slice(0, 217).trimEnd()}…` : body ?? '',
    }));
  }

  async vote(postId: string, userId: string, value: number) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId }, select: { status: true, moderation: true },
    });
    if (!post || post.status !== ContentStatus.PUBLISHED || post.moderation !== ModerationStatus.APPROVED) {
      throw new NotFoundException('Post not found');
    }

    if (value === 0) {
      await this.prisma.postVote.deleteMany({ where: { userId, postId } });
    } else {
      await this.prisma.postVote.upsert({
        where: { userId_postId: { userId, postId } },
        create: { userId, postId, value },
        update: { value },
      });
    }

    const [counts] = await this.withVotes([{ id: postId }], userId);
    return { up: counts.upvotes, down: counts.downvotes, myVote: counts.myVote };
  }

  /** Public feed: published, approved, and past the author's safety delay. Newest first. */
  async list(q: PostQueryDto, viewerId?: string) {
    const where: Prisma.PostWhereInput = {
      status: ContentStatus.PUBLISHED,
      moderation: ModerationStatus.APPROVED,
      OR: [{ visibleFrom: null }, { visibleFrom: { lte: new Date() } }],
      ...(q.authorId ? { authorId: q.authorId } : {}),
      ...(q.template ? { template: q.template } : {}),
      ...(q.destinationSlug ? { destination: { slug: q.destinationSlug } } : {}),
      ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where, select: POST_CARD,
        orderBy: { publishedAt: 'desc' },
        skip: q.skip, take: q.take,
      }),
      this.prisma.post.count({ where }),
    ]);

    return paged(await this.toCards(items, viewerId), total, q);
  }

  async findOne(id: string, viewerId?: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        author: {
          select: {
            id: true, name: true, avatarUrl: true, bio: true, homeDistrict: true,
            hideExactLocation: true,
          },
        },
        destination: { select: { slug: true, name: true, district: true } },
        photos: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!post) throw new NotFoundException('Post not found');

    const isOwner = viewerId && viewerId === post.authorId;
    const isLive =
      post.status === ContentStatus.PUBLISHED &&
      post.moderation === ModerationStatus.APPROVED &&
      (!post.visibleFrom || post.visibleFrom <= new Date());
    if (!isLive && !isOwner) throw new NotFoundException('Post not found');

    // Solo-traveller privacy: blur coordinates for everyone but the author.
    let latitude = post.latitude;
    let longitude = post.longitude;
    if (!isOwner && post.author.hideExactLocation && latitude != null && longitude != null) {
      ({ latitude, longitude } = fuzzCoords(latitude, longitude));
    }

    const [reactions, comments] = await Promise.all([
      this.prisma.reaction.count({ where: { targetType: 'POST', targetId: post.id } }),
      this.prisma.comment.count({
        where: { targetType: 'POST', targetId: post.id, moderation: 'APPROVED' },
      }),
    ]);

    const [voted] = await this.withVotes([post], viewerId);
    return { ...voted, latitude, longitude, counts: { reactions, comments } };
  }

  /**
   * Create or publish a post. Offline drafts arrive here on reconnection;
   * clientDraftId makes the sync idempotent so a flaky connection cannot
   * produce duplicates.
   */
  async create(dto: CreatePostDto, userId: string, publish = false) {
    this.assertOwnMedia(dto);
    /**
     * Publish-first: a post goes live straight away and reports pull it back.
     * Text that trips the word filter is the exception and waits for a moderator.
     */
    const live = publish && !needsReview(dto.title, dto.body, dto.locationName);
    /**
     * Idempotent offline sync. This uses its own column with a unique
     * constraint on (authorId, clientDraftId) rather than borrowing
     * moderationNote — a moderator writing a note would otherwise destroy
     * the key and a replayed draft would duplicate.
     */
    if (dto.clientDraftId) {
      const existing = await this.prisma.post.findUnique({
        where: {
          authorId_clientDraftId: { authorId: userId, clientDraftId: dto.clientDraftId },
        },
      });
      if (existing) return this.update(existing.id, dto, userId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { publishDelayHours: true },
    });

    return this.prisma.post.create({
      data: {
        authorId: userId,
        title: dto.title,
        body: dto.body,
        template: dto.template ?? 'FREEFORM',
        coverImageUrl: dto.coverImageUrl,
        destinationId: dto.destinationId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        locationName: dto.locationName,
        status: live ? ContentStatus.PUBLISHED : publish ? ContentStatus.IN_REVIEW : ContentStatus.DRAFT,
        moderation: live ? ModerationStatus.APPROVED : ModerationStatus.PENDING,
        publishedAt: live ? new Date() : undefined,
        clientDraftId: dto.clientDraftId,
        visibleFrom:
          publish && user?.publishDelayHours
            ? new Date(Date.now() + user.publishDelayHours * 3_600_000)
            : undefined,
        photos: dto.photos?.length
          ? {
              create: dto.photos.map((p, i) => ({
                url: p.url, caption: p.caption,
                latitude: p.latitude, longitude: p.longitude, sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { photos: true },
    });
  }

  async update(id: string, dto: UpdatePostDto, userId: string) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) throw new ForbiddenException('This is not your post');
    this.assertOwnMedia(dto);

    if (dto.photos) {
      await this.prisma.postPhoto.deleteMany({ where: { postId: id } });
      if (dto.photos.length) {
        await this.prisma.postPhoto.createMany({
          data: dto.photos.map((p, i) => ({
            postId: id, url: p.url, caption: p.caption,
            latitude: p.latitude, longitude: p.longitude, sortOrder: i,
          })),
        });
      }
    }

    return this.prisma.post.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        body: dto.body ?? undefined,
        template: dto.template,
        coverImageUrl: dto.coverImageUrl,
        destinationId: dto.destinationId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        locationName: dto.locationName,
        // An edit after rejection returns the post to the queue, and so does an
        // edit that makes a live post trip the word filter.
        moderation:
          post.moderation === ModerationStatus.REJECTED ||
          needsReview(dto.title ?? post.title, dto.body ?? post.body)
            ? ModerationStatus.PENDING
            : undefined,
      },
      include: { photos: true },
    });
  }

  /** Submit a draft for moderation. Nothing reaches the feed unreviewed. */
  async submit(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: { author: { select: { publishDelayHours: true } } },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) throw new ForbiddenException('This is not your post');

    return this.prisma.post.update({
      where: { id },
      data: {
        ...(needsReview(post.title, post.body, post.locationName)
          ? { status: ContentStatus.IN_REVIEW, moderation: ModerationStatus.PENDING }
          : { status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED, publishedAt: new Date() }),
        visibleFrom: post.author.publishDelayHours
          ? new Date(Date.now() + post.author.publishDelayHours * 3_600_000)
          : undefined,
      },
    });
  }

  async remove(id: string, userId: string, role: Role) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    const privileged = role === Role.ADMIN || role === Role.MODERATOR;
    if (post.authorId !== userId && !privileged) {
      throw new ForbiddenException('This is not your post');
    }
    await this.prisma.post.delete({ where: { id } });
    return { deleted: true };
  }

  async myPosts(userId: string, q: PostQueryDto) {
    const posts = await this.prisma.post.findMany({
      where: { authorId: userId, ...(q.status ? { status: q.status } : {}) },
      select: { ...POST_CARD, status: true, moderation: true, moderationNote: true },
      orderBy: { updatedAt: 'desc' },
      skip: q.skip, take: q.take,
    });
    return this.toCards(posts, userId);
  }

  /** Photos as map pins — the "photo-to-map linking" feature in Module 4. */
  async mapPins(bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }) {
    return this.prisma.postPhoto.findMany({
      where: {
        latitude: { gte: bbox.minLat, lte: bbox.maxLat },
        longitude: { gte: bbox.minLng, lte: bbox.maxLng },
        post: { status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED },
      },
      take: 300,
      select: {
        id: true, url: true, caption: true, latitude: true, longitude: true,
        post: { select: { id: true, title: true } },
      },
    });
  }
}
