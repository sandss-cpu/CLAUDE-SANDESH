import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentStatus, CreatorProfile, CreatorStatus, ModerationStatus, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import { needsReview } from '../../common/utils/content-filter';
import { slugify, uniqueSlug } from '../../common/utils/slug.util';
import {
  AddJourneyPostDto, ApplyCreatorDto, CreatorListQueryDto, CreatorReviewDto, HANDLE_RULE,
  RESERVED_HANDLES, ReorderJourneyPostsDto, SaveJourneyDto, UpdateCreatorDto,
} from './dto/creator.dto';

/** Only posts that are actually public appear on a profile. */
const LIVE_POST = {
  status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED,
} satisfies Prisma.PostWhereInput;

const POST_CARD = {
  id: true, title: true, body: true, coverImageUrl: true, locationName: true, latitude: true, longitude: true,
  publishedAt: true, createdAt: true,
  photos: { select: { url: true, caption: true }, orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.PostSelect;

const PUBLIC_PROFILE = {
  id: true, handle: true, displayName: true, headline: true, bio: true, avatarUrl: true, coverUrl: true,
  homeBase: true, languages: true, specialities: true, websiteUrl: true, instagram: true, youtube: true,
  isFeatured: true, approvedAt: true, userId: true,
} satisfies Prisma.CreatorProfileSelect;

const excerpt = (s: string, max = 180) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Creator profiles. What Instagram leaves out is the point of this: every journey
 * carries the road it followed, how many days it took, what it actually cost and
 * what was worth carrying, and each entry keeps the votes and comments of the
 * original post rather than becoming a separate copy.
 */
@Injectable()
export class CreatorsService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private assertMedia(...urls: Array<string | null | undefined>) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if (urls.filter(Boolean).some((u) => !isOwnMediaUrl(u, base))) {
      throw new BadRequestException('Upload images through Bato.');
    }
  }

  private totalCost(j: { transportNpr: number | null; stayNpr: number | null; foodNpr: number | null; permitsNpr: number | null; otherNpr: number | null }) {
    const parts = [j.transportNpr, j.stayNpr, j.foodNpr, j.permitsNpr, j.otherNpr].filter((n): n is number => n != null);
    return parts.length ? parts.reduce((a, b) => a + b, 0) : null;
  }

  private journeyView<T extends { entries?: unknown[] }>(journey: T & Parameters<CreatorsService['totalCost']>[0]) {
    return { ...journey, totalCostNpr: this.totalCost(journey) };
  }

  /** Posts, votes received and followers: the numbers a creator is judged on. */
  private async stats(userId: string) {
    const [posts, journeys, followers, votes] = await Promise.all([
      this.prisma.post.count({ where: { authorId: userId, ...LIVE_POST } }),
      this.prisma.creatorJourney.count({ where: { creator: { userId }, status: ContentStatus.PUBLISHED } }),
      this.prisma.follow.count({ where: { followingId: userId } }),
      this.prisma.postVote.count({ where: { value: 1, post: { authorId: userId } } }),
    ]);
    return { posts, journeys, followers, upvotes: votes };
  }

  // ---------------- public ----------------

  async list(q: CreatorListQueryDto) {
    const text = q.q?.trim();
    const profiles = await this.prisma.creatorProfile.findMany({
      where: {
        status: CreatorStatus.APPROVED,
        ...(text ? {
          OR: [
            { handle: { contains: text.toLowerCase() } },
            { displayName: { contains: text, mode: 'insensitive' } },
            { specialities: { has: text.toLowerCase() } },
            { homeBase: { contains: text, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: { ...PUBLIC_PROFILE, _count: { select: { journeys: true } } },
      orderBy: [{ isFeatured: 'desc' }, { approvedAt: 'desc' }],
      take: 60,
    });
    const counts = await this.prisma.post.groupBy({
      by: ['authorId'],
      where: { authorId: { in: profiles.map((p) => p.userId) }, ...LIVE_POST },
      _count: { _all: true },
    });
    return profiles.map(({ _count, userId, ...p }) => ({
      ...p,
      journeys: _count.journeys,
      posts: counts.find((c) => c.authorId === userId)?._count._all ?? 0,
    }));
  }

  async profile(handle: string, viewerId?: string) {
    const creator = await this.prisma.creatorProfile.findFirst({
      where: { handle: handle.toLowerCase(), status: CreatorStatus.APPROVED },
      select: PUBLIC_PROFILE,
    });
    if (!creator) throw new NotFoundException('No creator with that handle.');

    const [journeys, posts, stats, following] = await Promise.all([
      this.prisma.creatorJourney.findMany({
        where: { creator: { handle: handle.toLowerCase() }, status: ContentStatus.PUBLISHED },
        orderBy: [{ publishedAt: 'desc' }],
        include: { route: { select: { id: true, name: true, code: true } }, _count: { select: { entries: true } } },
      }),
      this.prisma.post.findMany({
        where: { authorId: creator.userId, ...LIVE_POST },
        select: POST_CARD,
        orderBy: { publishedAt: 'desc' },
        take: 30,
      }),
      this.stats(creator.userId),
      viewerId
        ? this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: viewerId, followingId: creator.userId } } })
        : null,
    ]);

    const { userId, ...publicFields } = creator;
    return {
      ...publicFields,
      stats,
      isFollowing: !!following,
      isMe: viewerId === userId,
      journeys: journeys.map(({ _count, ...j }) => ({ ...this.journeyView(j), entryCount: _count.entries })),
      posts: posts.map((p) => ({ ...p, body: excerpt(p.body) })),
      /** Where their posts were taken, for the map on the profile. */
      pins: posts
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => ({ id: p.id, title: p.title, latitude: p.latitude, longitude: p.longitude, locationName: p.locationName })),
    };
  }

  async journey(handle: string, slug: string) {
    const journey = await this.prisma.creatorJourney.findFirst({
      where: {
        slug, status: ContentStatus.PUBLISHED,
        creator: { handle: handle.toLowerCase(), status: CreatorStatus.APPROVED },
      },
      include: {
        creator: { select: { handle: true, displayName: true, avatarUrl: true, headline: true } },
        route: { select: { id: true, name: true, code: true, startPlace: true, endPlace: true } },
        destination: { select: { id: true, name: true, slug: true } },
        entries: { orderBy: { sortOrder: 'asc' }, include: { post: { select: POST_CARD } } },
      },
    });
    if (!journey) throw new NotFoundException('That journey is not available.');
    return this.journeyView(journey);
  }

  // ---------------- the creator's own panel ----------------

  private async mine(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) throw new NotFoundException('You do not have a creator profile yet.');
    return creator;
  }

  private assertActive(creator: CreatorProfile) {
    if (creator.status === CreatorStatus.SUSPENDED) {
      throw new ForbiddenException(creator.reviewNote || 'Your creator profile is suspended. Contact Bato.');
    }
  }

  async apply(dto: ApplyCreatorDto, userId: string) {
    const existing = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (existing) throw new ConflictException('You have already applied for creator access.');
    const handle = dto.handle.toLowerCase();
    if (!HANDLE_RULE.test(handle) || RESERVED_HANDLES.includes(handle)) {
      throw new BadRequestException('That handle is not available. Try another.');
    }
    if (await this.prisma.creatorProfile.findUnique({ where: { handle }, select: { id: true } })) {
      throw new ConflictException('That handle is taken.');
    }
    if (needsReview(dto.displayName, dto.headline, dto.bio)) {
      throw new BadRequestException('Please rewrite your profile without that language.');
    }
    this.assertMedia(dto.avatarUrl, dto.coverUrl);

    await this.prisma.creatorProfile.create({
      data: {
        userId, handle, displayName: dto.displayName, headline: dto.headline, bio: dto.bio,
        homeBase: dto.homeBase, specialities: dto.specialities ?? [], languages: dto.languages ?? [],
        avatarUrl: dto.avatarUrl, coverUrl: dto.coverUrl, websiteUrl: dto.websiteUrl,
        instagram: dto.instagram, youtube: dto.youtube, status: CreatorStatus.PENDING,
      },
    });
    return this.dashboard(userId);
  }

  /** Everything the creator panel shows: profile, journeys (including drafts) and their posts. */
  async dashboard(userId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { userId } });
    if (!creator) return null;
    const [journeys, posts, stats] = await Promise.all([
      this.prisma.creatorJourney.findMany({
        where: { creatorId: creator.id },
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          route: { select: { id: true, name: true, code: true } },
          entries: { orderBy: { sortOrder: 'asc' }, include: { post: { select: { id: true, title: true, coverImageUrl: true, publishedAt: true } } } },
        },
      }),
      this.prisma.post.findMany({
        where: { authorId: userId },
        select: { id: true, title: true, coverImageUrl: true, status: true, moderation: true, publishedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.stats(userId),
    ]);
    return { profile: creator, stats, journeys: journeys.map((j) => this.journeyView(j)), posts };
  }

  async updateMe(dto: UpdateCreatorDto, userId: string) {
    const creator = await this.mine(userId);
    this.assertActive(creator);
    if (needsReview(dto.displayName, dto.headline, dto.bio)) {
      throw new BadRequestException('Please rewrite your profile without that language.');
    }
    this.assertMedia(dto.avatarUrl, dto.coverUrl);
    await this.prisma.creatorProfile.update({
      where: { userId },
      data: {
        displayName: dto.displayName, headline: dto.headline ?? null, bio: dto.bio ?? null,
        homeBase: dto.homeBase ?? null, specialities: dto.specialities ?? [], languages: dto.languages ?? [],
        avatarUrl: dto.avatarUrl ?? null, coverUrl: dto.coverUrl ?? null, websiteUrl: dto.websiteUrl ?? null,
        instagram: dto.instagram ?? null, youtube: dto.youtube ?? null,
      },
    });
    return this.dashboard(userId);
  }

  async saveJourney(dto: SaveJourneyDto, userId: string, id?: string) {
    const creator = await this.mine(userId);
    this.assertActive(creator);
    this.assertMedia(dto.coverImageUrl);
    if (needsReview(dto.title, dto.summary, dto.tips)) {
      throw new BadRequestException('Please rewrite this without that language.');
    }
    const data = {
      title: dto.title, summary: dto.summary ?? null, coverImageUrl: dto.coverImageUrl ?? null,
      routeId: dto.routeId ?? null, destinationId: dto.destinationId ?? null,
      startedOn: dto.startedOn ? new Date(dto.startedOn) : null, dayCount: dto.dayCount ?? null,
      transportNpr: dto.transportNpr ?? null, stayNpr: dto.stayNpr ?? null, foodNpr: dto.foodNpr ?? null,
      permitsNpr: dto.permitsNpr ?? null, otherNpr: dto.otherNpr ?? null,
      gear: dto.gear ?? [], tips: dto.tips ?? null,
    };

    if (id) {
      await this.ownJourney(id, creator.id);
      await this.prisma.creatorJourney.update({ where: { id }, data });
    } else {
      const slug = await uniqueSlug(dto.title, async (s) =>
        !!(await this.prisma.creatorJourney.findFirst({ where: { creatorId: creator.id, slug: s }, select: { id: true } })));
      await this.prisma.creatorJourney.create({ data: { ...data, slug, creatorId: creator.id } });
    }
    return this.dashboard(userId);
  }

  private async ownJourney(id: string, creatorId: string) {
    const journey = await this.prisma.creatorJourney.findFirst({ where: { id, creatorId } });
    if (!journey) throw new NotFoundException('Journey not found');
    return journey;
  }

  async setJourneyStatus(id: string, status: ContentStatus, userId: string) {
    const creator = await this.mine(userId);
    this.assertActive(creator);
    const journey = await this.ownJourney(id, creator.id);
    if (status === ContentStatus.PUBLISHED) {
      if (creator.status !== CreatorStatus.APPROVED) {
        throw new ForbiddenException('Bato is still reviewing your creator profile, so journeys stay private for now.');
      }
      const entries = await this.prisma.creatorJourneyPost.count({ where: { journeyId: id } });
      if (!entries) throw new BadRequestException('Add at least one post before publishing this journey.');
    }
    await this.prisma.creatorJourney.update({
      where: { id },
      data: { status, publishedAt: status === ContentStatus.PUBLISHED ? journey.publishedAt ?? new Date() : journey.publishedAt },
    });
    return this.dashboard(userId);
  }

  async deleteJourney(id: string, userId: string) {
    const creator = await this.mine(userId);
    await this.ownJourney(id, creator.id);
    await this.prisma.creatorJourney.delete({ where: { id } });
    return this.dashboard(userId);
  }

  async addPost(journeyId: string, dto: AddJourneyPostDto, userId: string) {
    const creator = await this.mine(userId);
    this.assertActive(creator);
    await this.ownJourney(journeyId, creator.id);
    const post = await this.prisma.post.findFirst({ where: { id: dto.postId, authorId: userId }, select: { id: true } });
    if (!post) throw new BadRequestException('Choose one of your own posts.');
    const last = await this.prisma.creatorJourneyPost.findFirst({
      where: { journeyId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
    });
    await this.prisma.creatorJourneyPost.upsert({
      where: { journeyId_postId: { journeyId, postId: dto.postId } },
      update: { dayNumber: dto.dayNumber ?? null, note: dto.note ?? null },
      create: {
        journeyId, postId: dto.postId, dayNumber: dto.dayNumber ?? null, note: dto.note ?? null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return this.dashboard(userId);
  }

  async removePost(journeyId: string, postId: string, userId: string) {
    const creator = await this.mine(userId);
    await this.ownJourney(journeyId, creator.id);
    await this.prisma.creatorJourneyPost.deleteMany({ where: { journeyId, postId } });
    return this.dashboard(userId);
  }

  async reorderPosts(journeyId: string, dto: ReorderJourneyPostsDto, userId: string) {
    const creator = await this.mine(userId);
    await this.ownJourney(journeyId, creator.id);
    const entries = await this.prisma.creatorJourneyPost.findMany({ where: { journeyId }, select: { postId: true } });
    const known = new Set(entries.map((e) => e.postId));
    if (dto.postIds.length !== known.size || dto.postIds.some((id) => !known.has(id))) {
      throw new BadRequestException('This journey changed elsewhere. Reload and try again.');
    }
    await this.prisma.$transaction(dto.postIds.map((postId, sortOrder) =>
      this.prisma.creatorJourneyPost.update({ where: { journeyId_postId: { journeyId, postId } }, data: { sortOrder } })));
    return this.dashboard(userId);
  }

  // ---------------- following ----------------

  async follow(handle: string, userId: string) {
    const creator = await this.prisma.creatorProfile.findFirst({
      where: { handle: handle.toLowerCase(), status: CreatorStatus.APPROVED }, select: { userId: true },
    });
    if (!creator) throw new NotFoundException('No creator with that handle.');
    if (creator.userId === userId) throw new BadRequestException('You cannot follow yourself.');
    await this.prisma.follow.upsert({
      where: { followerId_followingId: { followerId: userId, followingId: creator.userId } },
      update: {},
      create: { followerId: userId, followingId: creator.userId },
    });
    return { following: true, followers: await this.prisma.follow.count({ where: { followingId: creator.userId } }) };
  }

  async unfollow(handle: string, userId: string) {
    const creator = await this.prisma.creatorProfile.findFirst({
      where: { handle: handle.toLowerCase() }, select: { userId: true },
    });
    if (!creator) throw new NotFoundException('No creator with that handle.');
    await this.prisma.follow.deleteMany({ where: { followerId: userId, followingId: creator.userId } });
    return { following: false, followers: await this.prisma.follow.count({ where: { followingId: creator.userId } }) };
  }

  // ---------------- admin ----------------

  async adminList(q: CreatorListQueryDto) {
    const profiles = await this.prisma.creatorProfile.findMany({
      where: q.status ? { status: q.status } : {},
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, isSuspended: true } },
        _count: { select: { journeys: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
    const counts = await this.prisma.post.groupBy({
      by: ['authorId'], where: { authorId: { in: profiles.map((p) => p.userId) }, ...LIVE_POST }, _count: { _all: true },
    });
    return profiles.map(({ _count, ...p }) => ({
      ...p,
      journeys: _count.journeys,
      posts: counts.find((c) => c.authorId === p.userId)?._count._all ?? 0,
    }));
  }

  /** Approving is what "giving creator access" means: nothing is public before it. */
  async review(id: string, dto: CreatorReviewDto, adminId: string) {
    const creator = await this.prisma.creatorProfile.findUnique({ where: { id } });
    if (!creator) throw new NotFoundException('Creator not found');
    if (dto.status !== CreatorStatus.APPROVED && !dto.note) {
      throw new BadRequestException('Give the creator a reason; they see it in their panel.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.creatorProfile.update({
        where: { id },
        data: {
          status: dto.status,
          isFeatured: dto.isFeatured ?? creator.isFeatured,
          reviewNote: dto.note ?? null,
          approvedAt: dto.status === CreatorStatus.APPROVED ? creator.approvedAt ?? new Date() : creator.approvedAt,
          approvedById: dto.status === CreatorStatus.APPROVED ? adminId : creator.approvedById,
        },
      });
      // A suspended creator's journeys leave the public side with them.
      if (dto.status === CreatorStatus.SUSPENDED) {
        await tx.creatorJourney.updateMany({
          where: { creatorId: id, status: ContentStatus.PUBLISHED }, data: { status: ContentStatus.DRAFT },
        });
      }
      await tx.moderationEntry.create({
        data: {
          moderatorId: adminId, targetType: 'USER', targetId: creator.userId,
          action: dto.status === CreatorStatus.APPROVED ? 'APPROVE' : dto.status === CreatorStatus.SUSPENDED ? 'SUSPEND_USER' : 'REJECT',
          note: `Creator @${creator.handle}: ${dto.status}${dto.note ? ` — ${dto.note}` : ''}`,
        },
      });
    });
    return this.adminList({});
  }

  /** Used by the vlog feed to link an author to their profile. */
  async handlesFor(userIds: string[]) {
    if (!userIds.length) return [];
    return this.prisma.creatorProfile.findMany({
      where: { userId: { in: userIds }, status: CreatorStatus.APPROVED },
      select: { userId: true, handle: true, displayName: true, avatarUrl: true, isFeatured: true },
    });
  }
}
