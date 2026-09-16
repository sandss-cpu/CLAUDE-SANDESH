import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentStatus, GuideDirection, Prisma, RouteGuide, RouteGuideStop,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import {
  AdminGuideQueryDto, JourneyQueryDto, ReorderStopsDto, SaveGuideDto, SaveGuideStopDto,
} from './dto/guide.dto';

const STOP_SELECT = {
  id: true, kind: true, name: true, description: true, imageUrl: true, latitude: true, longitude: true,
  distanceFromStartKm: true, minutesFromStart: true, priceFromNpr: true, openingHours: true,
  contactPhone: true, tip: true, isHighlight: true, sortOrder: true, placeId: true, businessId: true,
  business: { select: { id: true, slug: true, name: true, category: true, phone: true, priceRange: true } },
  place: { select: { id: true, name: true, type: true, latitude: true, longitude: true } },
} satisfies Prisma.RouteGuideStopSelect;

type GuideWithRoute = RouteGuide & {
  route: { id: string; code: string; name: string; startPlace: string; endPlace: string; distanceKm: number | null; typicalHours: number | null };
};

/**
 * Route guides: an editor curates one corridor, and a traveller sees it laid out in
 * the direction they are actually going. A guide marked BOTH is written once in the
 * route's forward order and read backwards on the return leg.
 */
@Injectable()
export class GuidesService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private assertMedia(...urls: Array<string | null | undefined>) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if (urls.filter(Boolean).some((u) => !isOwnMediaUrl(u, base))) {
      throw new BadRequestException('Upload images through Bato.');
    }
  }

  /** Where this journey starts and ends, once the direction is applied. */
  private endpoints(guide: GuideWithRoute, direction: GuideDirection) {
    const reversed = direction === GuideDirection.REVERSE;
    return {
      from: reversed ? guide.route.endPlace : guide.route.startPlace,
      to: reversed ? guide.route.startPlace : guide.route.endPlace,
    };
  }

  /** A BOTH guide is offered as two journeys, one for each way round. */
  private directionsOf(guide: RouteGuide): GuideDirection[] {
    return guide.direction === GuideDirection.BOTH
      ? [GuideDirection.FORWARD, GuideDirection.REVERSE]
      : [guide.direction];
  }

  // ---------------- public ----------------

  /**
   * The journeys a traveller can pick from: "Kathmandu → Pokhara", "Pokhara →
   * Kathmandu", and so on, filtered by where they say they are heading.
   */
  async journeys(q: JourneyQueryDto) {
    const guides = await this.prisma.routeGuide.findMany({
      where: { status: ContentStatus.PUBLISHED, ...(q.routeId ? { routeId: q.routeId } : {}) },
      include: {
        route: { select: { id: true, code: true, name: true, startPlace: true, endPlace: true, distanceKm: true, typicalHours: true } },
        stops: { select: { id: true, name: true, kind: true, isHighlight: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      take: 100,
    });

    const matches = (text: string, term?: string) => !term || text.toLowerCase().includes(term.toLowerCase());
    const journeys = guides.flatMap((guide) =>
      this.directionsOf(guide).map((direction) => {
        const { from, to } = this.endpoints(guide as GuideWithRoute, direction);
        const highlights = guide.stops.filter((s) => s.isHighlight).slice(0, 3).map((s) => s.name);
        return {
          guideId: guide.id, direction, from, to,
          title: guide.title, summary: guide.summary, coverImageUrl: guide.coverImageUrl,
          route: guide.route,
          stopCount: guide.stops.length,
          highlights: highlights.length ? highlights : guide.stops.slice(0, 3).map((s) => s.name),
        };
      }),
    );
    return journeys.filter((j) => matches(j.from, q.from) && matches(j.to, q.to));
  }

  /** One guide, with its stops in travel order and the magazine stories for that corridor. */
  async findOne(id: string, direction?: GuideDirection) {
    const guide = await this.prisma.routeGuide.findFirst({
      where: { id, status: ContentStatus.PUBLISHED },
      include: {
        route: { select: { id: true, code: true, name: true, startPlace: true, endPlace: true, distanceKm: true, typicalHours: true } },
        stops: { select: STOP_SELECT, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!guide) throw new NotFoundException('This guide is not available.');

    const allowed = this.directionsOf(guide);
    const chosen = direction && allowed.includes(direction) ? direction : allowed[0];
    const stops = chosen === GuideDirection.REVERSE ? [...guide.stops].reverse() : guide.stops;

    const articles = await this.prisma.article.findMany({
      where: { status: ContentStatus.PUBLISHED, routeLinks: { some: { routeId: guide.routeId } } },
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
      take: 6,
      select: { id: true, slug: true, title: true, subtitle: true, coverImageUrl: true, readMinutes: true },
    });

    return {
      id: guide.id, title: guide.title, summary: guide.summary, coverImageUrl: guide.coverImageUrl,
      direction: chosen, directions: allowed, route: guide.route,
      ...this.endpoints(guide as GuideWithRoute, chosen),
      stops, articles,
    };
  }

  // ---------------- admin ----------------

  async adminList(q: AdminGuideQueryDto) {
    const guides = await this.prisma.routeGuide.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.routeId ? { routeId: q.routeId } : {}) },
      include: {
        route: { select: { id: true, code: true, name: true, startPlace: true, endPlace: true } },
        _count: { select: { stops: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
    return guides.map(({ _count, ...g }) => ({ ...g, stopCount: _count.stops }));
  }

  async adminOne(id: string) {
    const guide = await this.prisma.routeGuide.findUnique({
      where: { id },
      include: {
        route: { select: { id: true, code: true, name: true, startPlace: true, endPlace: true } },
        stops: { select: STOP_SELECT, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!guide) throw new NotFoundException('Guide not found');
    return guide;
  }

  async create(dto: SaveGuideDto, actorId: string) {
    this.assertMedia(dto.coverImageUrl);
    await this.assertRoute(dto.routeId);
    const guide = await this.prisma.routeGuide.create({
      data: {
        routeId: dto.routeId, direction: dto.direction, title: dto.title, summary: dto.summary,
        coverImageUrl: dto.coverImageUrl, sortOrder: dto.sortOrder ?? 0,
        status: dto.status ?? ContentStatus.DRAFT, createdById: actorId,
        publishedAt: dto.status === ContentStatus.PUBLISHED ? new Date() : null,
      },
    });
    return this.adminOne(guide.id);
  }

  async update(id: string, dto: SaveGuideDto) {
    const existing = await this.prisma.routeGuide.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Guide not found');
    this.assertMedia(dto.coverImageUrl);
    await this.assertRoute(dto.routeId);
    await this.prisma.routeGuide.update({
      where: { id },
      data: {
        routeId: dto.routeId, direction: dto.direction, title: dto.title,
        summary: dto.summary ?? null, coverImageUrl: dto.coverImageUrl ?? null,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        ...(dto.status ? this.statusData(dto.status, existing) : {}),
      },
    });
    return this.adminOne(id);
  }

  /** Publishing stamps the date once; re-publishing later keeps the original. */
  private statusData(status: ContentStatus, existing: RouteGuide) {
    return {
      status,
      publishedAt: status === ContentStatus.PUBLISHED ? existing.publishedAt ?? new Date() : existing.publishedAt,
    };
  }

  async setStatus(id: string, status: ContentStatus) {
    const existing = await this.prisma.routeGuide.findUnique({ where: { id }, include: { _count: { select: { stops: true } } } });
    if (!existing) throw new NotFoundException('Guide not found');
    if (status === ContentStatus.PUBLISHED && existing._count.stops === 0) {
      throw new BadRequestException('Add at least one stop before publishing this guide.');
    }
    await this.prisma.routeGuide.update({ where: { id }, data: this.statusData(status, existing) });
    return this.adminOne(id);
  }

  async remove(id: string) {
    const existing = await this.prisma.routeGuide.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Guide not found');
    await this.prisma.routeGuide.delete({ where: { id } });
    return { deleted: true };
  }

  async addStop(guideId: string, dto: SaveGuideStopDto) {
    await this.adminOne(guideId);
    await this.assertLinks(dto);
    this.assertMedia(dto.imageUrl);
    const last = await this.prisma.routeGuideStop.findFirst({
      where: { guideId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
    });
    await this.prisma.routeGuideStop.create({
      data: { ...this.stopData(dto), guideId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    return this.adminOne(guideId);
  }

  async updateStop(stopId: string, dto: SaveGuideStopDto) {
    const stop = await this.prisma.routeGuideStop.findUnique({ where: { id: stopId } });
    if (!stop) throw new NotFoundException('Stop not found');
    await this.assertLinks(dto);
    this.assertMedia(dto.imageUrl);
    await this.prisma.routeGuideStop.update({ where: { id: stopId }, data: this.stopData(dto) });
    return this.adminOne(stop.guideId);
  }

  async removeStop(stopId: string) {
    const stop = await this.prisma.routeGuideStop.findUnique({ where: { id: stopId } });
    if (!stop) throw new NotFoundException('Stop not found');
    await this.prisma.routeGuideStop.delete({ where: { id: stopId } });
    return this.adminOne(stop.guideId);
  }

  /** Drag-and-drop ordering: the ids arrive in the order the editor arranged them. */
  async reorder(guideId: string, dto: ReorderStopsDto) {
    const stops = await this.prisma.routeGuideStop.findMany({ where: { guideId }, select: { id: true } });
    const known = new Set(stops.map((s) => s.id));
    if (dto.ids.length !== known.size || dto.ids.some((id) => !known.has(id))) {
      throw new BadRequestException('The stop list is out of date. Reload and try again.');
    }
    await this.prisma.$transaction(
      dto.ids.map((id, sortOrder) => this.prisma.routeGuideStop.update({ where: { id }, data: { sortOrder } })),
    );
    return this.adminOne(guideId);
  }

  private stopData(dto: SaveGuideStopDto): Omit<Prisma.RouteGuideStopUncheckedCreateInput, 'guideId'> {
    return {
      kind: dto.kind, name: dto.name, description: dto.description ?? null, imageUrl: dto.imageUrl ?? null,
      latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
      distanceFromStartKm: dto.distanceFromStartKm ?? null, minutesFromStart: dto.minutesFromStart ?? null,
      priceFromNpr: dto.priceFromNpr ?? null, openingHours: dto.openingHours ?? null,
      contactPhone: dto.contactPhone ?? null, tip: dto.tip ?? null,
      placeId: dto.placeId ?? null, businessId: dto.businessId ?? null,
      isHighlight: dto.isHighlight ?? false,
    };
  }

  private async assertRoute(routeId: string) {
    const route = await this.prisma.route.findUnique({ where: { id: routeId }, select: { id: true } });
    if (!route) throw new BadRequestException('Choose a route from the list.');
  }

  private async assertLinks(dto: SaveGuideStopDto) {
    if (dto.businessId) {
      const business = await this.prisma.business.findUnique({ where: { id: dto.businessId }, select: { id: true } });
      if (!business) throw new BadRequestException('Choose a listed business, or leave it unlinked.');
    }
    if (dto.placeId) {
      const place = await this.prisma.place.findUnique({ where: { id: dto.placeId }, select: { id: true } });
      if (!place) throw new BadRequestException('Choose a mapped place, or leave it unlinked.');
    }
  }
}

export type { RouteGuideStop };
