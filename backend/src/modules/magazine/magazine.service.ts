import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paged } from '../../common/dto/pagination.dto';
import { readMinutes, uniqueSlug } from '../../common/utils/slug.util';
import {
  AdminArticleQueryDto, ArticleQueryDto, CreateArticleDto, CreateIssueDto, ElevatePostDto,
  UpdateArticleDto,
} from './dto/magazine.dto';

const ARTICLE_CARD = {
  id: true, slug: true, title: true, subtitle: true, coverImageUrl: true,
  audioUrl: true, readMinutes: true, language: true, isSponsored: true,
  isFeatured: true, publishedAt: true,
  category: { select: { slug: true, name: true, colorHex: true } },
  author: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ArticleSelect;

@Injectable()
export class MagazineService {
  constructor(private prisma: PrismaService) {}

  // ---------- public reading ----------

  async listArticles(q: ArticleQueryDto) {
    const where: Prisma.ArticleWhereInput = {
      status: ContentStatus.PUBLISHED,
      ...(q.categorySlug ? { category: { slug: q.categorySlug } } : {}),
      ...(q.issueId ? { issueId: q.issueId } : {}),
      ...(q.language ? { language: q.language } : {}),
      ...(q.featuredOnly ? { isFeatured: true } : {}),
      ...(q.routeId ? { routeLinks: { some: { routeId: q.routeId } } } : {}),
      ...(q.destinationSlug
        ? { destinations: { some: { destination: { slug: q.destinationSlug } } } }
        : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { subtitle: { contains: q.q, mode: 'insensitive' } },
              { body: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        select: ARTICLE_CARD,
        orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
        skip: q.skip, take: q.take,
      }),
      this.prisma.article.count({ where }),
    ]);

    return paged(items, total, q);
  }

  async getArticle(slug: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, status: ContentStatus.PUBLISHED },
      include: {
        category: { select: { slug: true, name: true, colorHex: true } },
        author: { select: { id: true, name: true, avatarUrl: true, homeDistrict: true } },
        issue: { select: { id: true, number: true, title: true } },
        sponsor: { select: { id: true, slug: true, name: true, category: true } },
        routeLinks: { include: { route: { select: { id: true, code: true, name: true } } } },
        destinations: {
          include: {
            destination: {
              select: { id: true, slug: true, name: true, latitude: true, longitude: true, district: true },
            },
          },
        },
      },
    });
    if (!article) throw new NotFoundException('Article not found');

    const [reactions, comments] = await Promise.all([
      this.prisma.reaction.count({ where: { targetType: 'ARTICLE', targetId: article.id } }),
      this.prisma.comment.count({
        where: { targetType: 'ARTICLE', targetId: article.id, moderation: 'APPROVED' },
      }),
    ]);

    return {
      ...article,
      routes: article.routeLinks.map((r) => r.route),
      places: article.destinations.map((d) => d.destination),
      routeLinks: undefined,
      destinations: undefined,
      counts: { reactions, comments },
    };
  }

  /** Current issue plus its contents — the magazine "cover" view. */
  async currentIssue() {
    const issue = await this.prisma.issue.findFirst({
      where: { status: ContentStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
    });
    if (!issue) return null;

    const articles = await this.prisma.article.findMany({
      where: { issueId: issue.id, status: ContentStatus.PUBLISHED },
      select: ARTICLE_CARD,
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'asc' }],
    });

    return { issue, articles };
  }

  listIssues() {
    return this.prisma.issue.findMany({
      where: { status: ContentStatus.PUBLISHED },
      orderBy: { number: 'desc' },
      select: {
        id: true, number: true, title: true, strapline: true,
        coverImageUrl: true, season: true, publishedAt: true,
        _count: { select: { articles: true } },
      },
    });
  }

  /** Every status — so an editor can see and publish an issue they just created. */
  adminListIssues() {
    return this.prisma.issue.findMany({
      orderBy: { number: 'desc' },
      select: {
        id: true, number: true, title: true, strapline: true, status: true,
        coverImageUrl: true, season: true, publishedAt: true,
        _count: { select: { articles: true } },
      },
    });
  }

  listCategories() {
    return this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  // ---------- editorial ----------

  /** Every status, not just PUBLISHED — this is what the admin panel's article list reads. */
  async adminListArticles(q: AdminArticleQueryDto) {
    const where: Prisma.ArticleWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.categorySlug ? { category: { slug: q.categorySlug } } : {}),
      ...(q.issueId ? { issueId: q.issueId } : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q, mode: 'insensitive' } },
              { subtitle: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        select: { ...ARTICLE_CARD, status: true, createdAt: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        skip: q.skip, take: q.take,
      }),
      this.prisma.article.count({ where }),
    ]);

    return paged(items, total, q);
  }

  /** Fetch an article by id regardless of status, to populate the edit form. */
  async adminGetArticle(id: string) {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        issue: { select: { id: true, number: true, title: true } },
        routeLinks: { select: { routeId: true } },
        destinations: { select: { destinationId: true } },
      },
    });
    if (!article) throw new NotFoundException('Article not found');
    return article;
  }

  /**
   * Permanent removal — irreversible, so this is admin-only at the controller
   * level. Editors use updateArticle(status: ARCHIVED) for the recoverable
   * "take it out of the magazine" action instead.
   */
  async deleteArticle(id: string, actorId: string) {
    const existing = await this.prisma.article.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Article not found');

    await this.prisma.$transaction([
      this.prisma.article.delete({ where: { id } }),
      this.prisma.moderationEntry.create({
        data: { moderatorId: actorId, targetType: 'ARTICLE', targetId: id, action: 'DELETE' },
      }),
    ]);

    return { deleted: true };
  }

  async createArticle(dto: CreateArticleDto, authorId: string) {
    const slug = await uniqueSlug(dto.title, async (s) =>
      !!(await this.prisma.article.findUnique({ where: { slug: s }, select: { id: true } })),
    );

    return this.prisma.article.create({
      data: {
        slug,
        title: dto.title,
        subtitle: dto.subtitle,
        body: dto.body,
        coverImageUrl: dto.coverImageUrl,
        audioUrl: dto.audioUrl,
        readMinutes: readMinutes(dto.body),
        language: dto.language ?? 'EN',
        categoryId: dto.categoryId,
        issueId: dto.issueId,
        authorId,
        isSponsored: dto.isSponsored ?? false,
        isFeatured: dto.isFeatured ?? false,
        sponsorBusinessId: dto.sponsorBusinessId,
        routeLinks: dto.routeIds?.length
          ? { create: dto.routeIds.map((routeId) => ({ routeId })) }
          : undefined,
        destinations: dto.destinationIds?.length
          ? { create: dto.destinationIds.map((destinationId) => ({ destinationId })) }
          : undefined,
      },
    });
  }

  async updateArticle(id: string, dto: UpdateArticleDto) {
    const existing = await this.prisma.article.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Article not found');

    if (dto.routeIds) {
      await this.prisma.articleRoute.deleteMany({ where: { articleId: id } });
      if (dto.routeIds.length) {
        await this.prisma.articleRoute.createMany({
          data: dto.routeIds.map((routeId) => ({ articleId: id, routeId })),
          skipDuplicates: true,
        });
      }
    }

    return this.prisma.article.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        subtitle: dto.subtitle,
        body: dto.body ?? undefined,
        coverImageUrl: dto.coverImageUrl,
        audioUrl: dto.audioUrl,
        readMinutes: dto.body ? readMinutes(dto.body) : undefined,
        categoryId: dto.categoryId,
        issueId: dto.issueId,
        isFeatured: dto.isFeatured,
        isSponsored: dto.isSponsored,
        status: dto.status,
        publishedAt:
          dto.status === ContentStatus.PUBLISHED && !existing.publishedAt
            ? new Date()
            : undefined,
      },
    });
  }

  async publishArticle(id: string) {
    return this.prisma.article.update({
      where: { id },
      data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  createIssue(dto: CreateIssueDto) {
    return this.prisma.issue.create({ data: dto });
  }

  async publishIssue(id: string) {
    return this.prisma.issue.update({
      where: { id },
      data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  /**
   * Editorial elevation (spec Module 2): promote a community post into the
   * magazine, keeping the traveller's byline. This is the contribution
   * incentive that makes the UGC loop work.
   */
  async elevatePost(dto: ElevatePostDto, editorId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: dto.postId },
      include: { photos: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== ContentStatus.PUBLISHED || post.moderation !== 'APPROVED') {
      throw new BadRequestException('Only an approved, published post can be elevated');
    }
    if (post.isElevated) throw new BadRequestException('This post is already in the magazine');

    const slug = await uniqueSlug(post.title, async (s) =>
      !!(await this.prisma.article.findUnique({ where: { slug: s }, select: { id: true } })),
    );

    return this.prisma.$transaction(async (tx) => {
      const article = await tx.article.create({
        data: {
          slug,
          title: post.title,
          subtitle: post.locationName ?? undefined,
          body: post.body,
          coverImageUrl: post.coverImageUrl ?? post.photos[0]?.url,
          readMinutes: readMinutes(post.body),
          status: ContentStatus.PUBLISHED,
          publishedAt: new Date(),
          authorId: post.authorId,          // the traveller keeps the byline
          categoryId: dto.categoryId,
          issueId: dto.issueId,
          sourcePostId: post.id,
          routeLinks: dto.routeIds?.length
            ? { create: dto.routeIds.map((routeId) => ({ routeId })) }
            : undefined,
        },
      });

      await tx.post.update({ where: { id: post.id }, data: { isElevated: true } });

      await tx.moderationEntry.create({
        data: {
          moderatorId: editorId,
          targetType: 'POST',
          targetId: post.id,
          action: 'APPROVE',
          note: `Elevated to magazine article ${article.slug}. ${dto.editorNote ?? ''}`.trim(),
        },
      });

      return article;
    });
  }
}
