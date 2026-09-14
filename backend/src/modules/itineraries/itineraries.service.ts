import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetStyle } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { shareToken } from '../../common/utils/slug.util';
import {
  CreateItineraryDto, FromArticleDto, SuggestItineraryDto, UpdateItineraryDto,
} from './dto/itinerary.dto';

/** Realistic NPR per-person daily costs. Adjust seasonally in production. */
const DAILY_COST_NPR: Record<BudgetStyle, { low: number; high: number }> = {
  BACKPACKER: { low: 1500, high: 2800 },
  STANDARD: { low: 3000, high: 6500 },
  COMFORT: { low: 7000, high: 18000 },
};

const FULL_INCLUDE = {
  days: {
    orderBy: { dayNumber: 'asc' as const },
    include: {
      stops: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          place: { select: { id: true, name: true, type: true, latitude: true, longitude: true } },
          business: { select: { id: true, slug: true, name: true, category: true, phone: true } },
        },
      },
    },
  },
};

@Injectable()
export class ItinerariesService {
  constructor(private prisma: PrismaService) {}

  /** Ready-made templates: ABC trek, Kathmandu heritage loop, and so on. */
  templates() {
    return this.prisma.itinerary.findMany({
      where: { isTemplate: true },
      select: {
        id: true, title: true, summary: true, dayCount: true,
        budgetStyle: true, estimatedCostNpr: true,
      },
      orderBy: { dayCount: 'asc' },
    });
  }

  async findOne(id: string, viewerId?: string) {
    const it = await this.prisma.itinerary.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!it) throw new NotFoundException('Itinerary not found');
    if (!it.isPublic && !it.isTemplate && it.userId !== viewerId) {
      throw new ForbiddenException('This trip is private');
    }
    return it;
  }

  /** Read-only access by share link, no account required. */
  async byShareToken(token: string) {
    const it = await this.prisma.itinerary.findUnique({
      where: { shareToken: token },
      include: FULL_INCLUDE,
    });
    if (!it) throw new NotFoundException('Trip link not found');
    return it;
  }

  mine(userId: string) {
    return this.prisma.itinerary.findMany({
      where: { userId },
      select: {
        id: true, title: true, summary: true, dayCount: true, budgetStyle: true,
        estimatedCostNpr: true, isPublic: true, shareToken: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(dto: CreateItineraryDto, userId: string) {
    const dayCount = dto.days?.length ?? 1;
    return this.prisma.itinerary.create({
      data: {
        userId,
        title: dto.title,
        summary: dto.summary,
        budgetStyle: dto.budgetStyle ?? BudgetStyle.STANDARD,
        dayCount,
        estimatedCostNpr: this.estimateCost(dayCount, dto.budgetStyle ?? BudgetStyle.STANDARD),
        isPublic: dto.isPublic ?? false,
        shareToken: shareToken(),
        sourceArticleId: dto.sourceArticleId,
        days: dto.days?.length
          ? {
              create: dto.days.map((d) => ({
                dayNumber: d.dayNumber,
                title: d.title,
                notes: d.notes,
                stops: d.stops?.length
                  ? {
                      create: d.stops.map((s, i) => ({
                        name: s.name, time: s.time, notes: s.notes, costNpr: s.costNpr,
                        placeId: s.placeId, businessId: s.businessId, sortOrder: i,
                      })),
                    }
                  : undefined,
              })),
            }
          : undefined,
      },
      include: FULL_INCLUDE,
    });
  }

  /** Full replace of the day plan — simplest correct semantics for drag-and-drop. */
  async update(id: string, dto: UpdateItineraryDto, userId: string) {
    const existing = await this.prisma.itinerary.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Itinerary not found');
    if (existing.userId !== userId) throw new ForbiddenException('This is not your trip');

    return this.prisma.$transaction(async (tx) => {
      if (dto.days) {
        await tx.itineraryDay.deleteMany({ where: { itineraryId: id } });
        for (const d of dto.days) {
          await tx.itineraryDay.create({
            data: {
              itineraryId: id,
              dayNumber: d.dayNumber,
              title: d.title,
              notes: d.notes,
              stops: d.stops?.length
                ? {
                    create: d.stops.map((s, i) => ({
                      name: s.name, time: s.time, notes: s.notes, costNpr: s.costNpr,
                      placeId: s.placeId, businessId: s.businessId, sortOrder: i,
                    })),
                  }
                : undefined,
            },
          });
        }
      }

      const dayCount = dto.days?.length ?? existing.dayCount;
      const style = dto.budgetStyle ?? existing.budgetStyle;

      return tx.itinerary.update({
        where: { id },
        data: {
          title: dto.title ?? undefined,
          summary: dto.summary,
          budgetStyle: dto.budgetStyle,
          isPublic: dto.isPublic,
          dayCount,
          estimatedCostNpr: this.estimateCost(dayCount, style),
        },
        include: FULL_INCLUDE,
      });
    });
  }

  async remove(id: string, userId: string) {
    const it = await this.prisma.itinerary.findUnique({ where: { id } });
    if (!it) throw new NotFoundException('Itinerary not found');
    if (it.userId !== userId) throw new ForbiddenException('This is not your trip');
    await this.prisma.itinerary.delete({ where: { id } });
    return { deleted: true };
  }

  /** Copy a template or a public trip into the user's own editable copy. */
  async fork(id: string, userId: string) {
    const src = await this.prisma.itinerary.findUnique({ where: { id }, include: FULL_INCLUDE });
    if (!src) throw new NotFoundException('Itinerary not found');
    if (!src.isPublic && !src.isTemplate) throw new ForbiddenException('This trip is private');

    return this.create(
      {
        title: src.title,
        summary: src.summary ?? undefined,
        budgetStyle: src.budgetStyle,
        days: src.days.map((d) => ({
          dayNumber: d.dayNumber,
          title: d.title ?? undefined,
          notes: d.notes ?? undefined,
          stops: d.stops.map((s) => ({
            name: s.name, time: s.time ?? undefined, notes: s.notes ?? undefined,
            costNpr: s.costNpr ?? undefined, placeId: s.placeId ?? undefined,
            businessId: s.businessId ?? undefined,
          })),
        })),
      },
      userId,
    );
  }

  /**
   * "Article to itinerary" (spec Module 5): one tap turns a story into an
   * editable plan, seeded with the destinations the article is tagged to.
   */
  async fromArticle(dto: FromArticleDto, userId: string) {
    const article = await this.prisma.article.findUnique({
      where: { slug: dto.articleSlug },
      include: { destinations: { include: { destination: true } } },
    });
    if (!article) throw new NotFoundException('Article not found');

    const destinations = article.destinations.map((d) => d.destination);
    const dayCount = dto.days ?? Math.max(1, Math.min(destinations.length || 2, 7));

    const days = Array.from({ length: dayCount }, (_, i) => {
      const dest = destinations[i % Math.max(1, destinations.length)];
      return {
        dayNumber: i + 1,
        title: dest ? dest.name : `Day ${i + 1}`,
        stops: dest
          ? [{ name: dest.name, notes: `From "${article.title}"`, time: 'Morning' }]
          : [],
      };
    });

    return this.create(
      {
        title: `Trip: ${article.title}`,
        summary: article.subtitle ?? undefined,
        sourceArticleId: article.id,
        days,
      },
      userId,
    );
  }

  /** Draft plan from days + budget + destination. Deliberately simple and editable. */
  async suggest(dto: SuggestItineraryDto, userId: string) {
    const destination = dto.destinationSlug
      ? await this.prisma.destination.findUnique({
          where: { slug: dto.destinationSlug },
          include: { places: { take: 30 } },
        })
      : null;

    const pool = destination?.places ?? [];
    const perDay = Math.max(1, Math.ceil(pool.length / dto.days)) || 2;

    const days = Array.from({ length: dto.days }, (_, i) => ({
      dayNumber: i + 1,
      title: destination ? `${destination.name} — Day ${i + 1}` : `Day ${i + 1}`,
      stops: pool.slice(i * perDay, i * perDay + perDay).map((p, j) => ({
        name: p.name,
        time: j === 0 ? 'Morning' : j === 1 ? 'Afternoon' : 'Evening',
        placeId: p.id,
      })),
    }));

    return this.create(
      {
        title: destination ? `${dto.days} days in ${destination.name}` : `${dto.days}-day trip`,
        budgetStyle: dto.budgetStyle,
        days,
      },
      userId,
    );
  }

  /** Permit checklist: TIMS, ACAP, Sagarmatha and restricted areas. */
  permits(region?: string) {
    return this.prisma.permit.findMany({
      where: region ? { region: { contains: region, mode: 'insensitive' } } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  budgetBreakdown(days: number, style: BudgetStyle = BudgetStyle.STANDARD) {
    const band = DAILY_COST_NPR[style];
    return {
      days,
      style,
      perDayNpr: band,
      totalNpr: { low: band.low * days, high: band.high * days },
      note: 'Per person, excluding permits, long-distance transport and gear hire.',
    };
  }

  private estimateCost(days: number, style: BudgetStyle): number {
    const band = DAILY_COST_NPR[style];
    return Math.round(((band.low + band.high) / 2) * days);
  }
}
