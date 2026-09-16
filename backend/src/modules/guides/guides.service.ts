import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContentStatus, GuideDirection, GuideKind, Prisma, RouteGuide,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import {
  AdminGuideQueryDto, JourneyQueryDto, ReorderStopsDto, SaveGuideDto, SaveGuideStopDto,
} from './dto/guide.dto';

const STOP_SELECT = {
  id: true, kind: true, name: true, description: true, imageUrl: true, latitude: true, longitude: true,
  dayNumber: true, distanceFromStartKm: true, minutesFromStart: true, priceFromNpr: true, openingHours: true,
  contactPhone: true, tip: true, isHighlight: true, sortOrder: true, placeId: true, businessId: true,
  business: { select: { id: true, slug: true, name: true, category: true, phone: true, priceRange: true } },
  place: { select: { id: true, name: true, type: true, latitude: true, longitude: true } },
} satisfies Prisma.RouteGuideStopSelect;

const ROUTE_SELECT = {
  id: true, code: true, name: true, startPlace: true, endPlace: true, distanceKm: true, typicalHours: true,
} satisfies Prisma.RouteSelect;

const DESTINATION_SELECT = {
  id: true, slug: true, name: true, district: true, province: true, heroImageUrl: true,
} satisfies Prisma.DestinationSelect;

type GuideWithTargets = RouteGuide & {
  route?: { startPlace: string; endPlace: string } | null;
  destination?: { name: string; district: string } | null;
};

/**
 * Two kinds of guide, both written by editors:
 *
 * - ROUTE: a corridor in travel order, read in the direction the traveller is going.
 *   A guide marked BOTH is written once start → end and reversed on the return leg.
 * - DESTINATION: a day-by-day plan for a place, whose stops carry day numbers.
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

  /** Where this guide starts and ends, once the direction is applied. */
  private endpoints(guide: GuideWithTargets, direction: GuideDirection) {
    if (guide.kind === GuideKind.DESTINATION) {
      const name = guide.destination?.name ?? '';
      return { from: name, to: name };
    }
    const reversed = direction === GuideDirection.REVERSE;
    return {
      from: reversed ? guide.route?.endPlace ?? '' : guide.route?.startPlace ?? '',
      to: reversed ? guide.route?.startPlace ?? '' : guide.route?.endPlace ?? '',
    };
  }

  /** A BOTH route guide is offered as two journeys; a place itinerary is only ever one. */
  private directionsOf(guide: RouteGuide): GuideDirection[] {
    if (guide.kind === GuideKind.DESTINATION) return [GuideDirection.BOTH];
    return guide.direction === GuideDirection.BOTH
      ? [GuideDirection.FORWARD, GuideDirection.REVERSE]
      : [guide.direction];
  }

  /** Stops of a place itinerary, gathered into the days an editor put them in. */
  private byDay<T extends { dayNumber: number | null }>(stops: T[]) {
    const days = new Map<number, T[]>();
    for (const stop of stops) {
      const day = stop.dayNumber ?? 1;
      days.set(day, [...(days.get(day) ?? []), stop]);
    }
    return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([dayNumber, items]) => ({ dayNumber, stops: items }));
  }

  // ---------------- public ----------------

  /**
   * What a traveller chooses from: "Kathmandu → Pokhara", "Pokhara → Kathmandu",
   * "3 days in Pokhara", filtered by where they say they are heading.
   */
  async journeys(q: JourneyQueryDto) {
    const guides = await this.prisma.routeGuide.findMany({
      where: {
        status: ContentStatus.PUBLISHED,
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.routeId ? { routeId: q.routeId } : {}),
        ...(q.destinationId ? { destinationId: q.destinationId } : {}),
      },
      include: {
        route: { select: ROUTE_SELECT },
        destination: { select: DESTINATION_SELECT },
        stops: { select: { id: true, name: true, kind: true, isHighlight: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      take: 200,
    });

    const matches = (text: string, term?: string) => !term || text.toLowerCase().includes(term.toLowerCase());
    const journeys = guides.flatMap((guide) =>
      this.directionsOf(guide).map((direction) => {
        const { from, to } = this.endpoints(guide as GuideWithTargets, direction);
        const highlights = guide.stops.filter((s) => s.isHighlight).slice(0, 3).map((s) => s.name);
        return {
          guideId: guide.id, kind: guide.kind, direction, from, to,
          title: guide.title, summary: guide.summary, coverImageUrl: guide.coverImageUrl,
          dayCount: guide.dayCount,
          route: guide.route, destination: guide.destination,
          stopCount: guide.stops.length,
          highlights: highlights.length ? highlights : guide.stops.slice(0, 3).map((s) => s.name),
        };
      }),
    );
    return journeys.filter((j) =>
      (matches(j.from, q.from) && matches(j.to, q.to))
      // A place itinerary should also be found by typing the place into either box.
      || (j.kind === GuideKind.DESTINATION && matches(j.from, q.from ?? q.to)));
  }

  /** One guide, in travel order (or by day), with the stories for that road or place. */
  async findOne(id: string, direction?: GuideDirection) {
    const guide = await this.prisma.routeGuide.findFirst({
      where: { id, status: ContentStatus.PUBLISHED },
      include: {
        route: { select: ROUTE_SELECT },
        destination: { select: DESTINATION_SELECT },
        stops: { select: STOP_SELECT, orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }] },
      },
    });
    if (!guide) throw new NotFoundException('This guide is not available.');

    const allowed = this.directionsOf(guide);
    const chosen = direction && allowed.includes(direction) ? direction : allowed[0];
    const isPlace = guide.kind === GuideKind.DESTINATION;
    const stops = !isPlace && chosen === GuideDirection.REVERSE ? [...guide.stops].reverse() : guide.stops;

    const articles = await this.prisma.article.findMany({
      where: {
        status: ContentStatus.PUBLISHED,
        ...(isPlace
          ? { destinations: { some: { destinationId: guide.destinationId } } }
          : { routeLinks: { some: { routeId: guide.routeId } } }),
      },
      orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
      take: 6,
      select: { id: true, slug: true, title: true, subtitle: true, coverImageUrl: true, readMinutes: true },
    });

    return {
      id: guide.id, kind: guide.kind, title: guide.title, summary: guide.summary,
      coverImageUrl: guide.coverImageUrl, dayCount: guide.dayCount,
      direction: chosen, directions: allowed,
      route: guide.route, destination: guide.destination,
      ...this.endpoints(guide as GuideWithTargets, chosen),
      stops,
      days: isPlace ? this.byDay(stops) : null,
      articles,
    };
  }

  // ---------------- admin ----------------

  async adminList(q: AdminGuideQueryDto) {
    const guides = await this.prisma.routeGuide.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.routeId ? { routeId: q.routeId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
      },
      include: {
        route: { select: ROUTE_SELECT },
        destination: { select: DESTINATION_SELECT },
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
        route: { select: ROUTE_SELECT },
        destination: { select: DESTINATION_SELECT },
        stops: { select: STOP_SELECT, orderBy: [{ dayNumber: 'asc' }, { sortOrder: 'asc' }] },
      },
    });
    if (!guide) throw new NotFoundException('Guide not found');
    return { ...guide, days: guide.kind === GuideKind.DESTINATION ? this.byDay(guide.stops) : null };
  }

  async create(dto: SaveGuideDto, actorId: string) {
    this.assertMedia(dto.coverImageUrl);
    const target = await this.checkedTarget(dto);
    const guide = await this.prisma.routeGuide.create({
      data: {
        kind: dto.kind, ...target, direction: dto.direction, title: dto.title, summary: dto.summary,
        coverImageUrl: dto.coverImageUrl, dayCount: dto.dayCount, sortOrder: dto.sortOrder ?? 0,
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
    const target = await this.checkedTarget(dto);
    await this.prisma.routeGuide.update({
      where: { id },
      data: {
        kind: dto.kind, ...target, direction: dto.direction, title: dto.title,
        summary: dto.summary ?? null, coverImageUrl: dto.coverImageUrl ?? null,
        dayCount: dto.dayCount ?? null, sortOrder: dto.sortOrder ?? existing.sortOrder,
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
    const existing = await this.prisma.routeGuide.findUnique({
      where: { id }, include: { _count: { select: { stops: true } } },
    });
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
    const guide = await this.adminOne(guideId);
    await this.assertLinks(dto);
    this.assertMedia(dto.imageUrl);
    const last = await this.prisma.routeGuideStop.findFirst({
      where: { guideId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true },
    });
    await this.prisma.routeGuideStop.create({
      data: { ...this.stopData(dto, guide.kind), guideId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    return this.adminOne(guideId);
  }

  async updateStop(stopId: string, dto: SaveGuideStopDto) {
    const stop = await this.prisma.routeGuideStop.findUnique({
      where: { id: stopId }, include: { guide: { select: { kind: true } } },
    });
    if (!stop) throw new NotFoundException('Stop not found');
    await this.assertLinks(dto);
    this.assertMedia(dto.imageUrl);
    await this.prisma.routeGuideStop.update({ where: { id: stopId }, data: this.stopData(dto, stop.guide.kind) });
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

  private stopData(dto: SaveGuideStopDto, guideKind: GuideKind): Omit<Prisma.RouteGuideStopUncheckedCreateInput, 'guideId'> {
    return {
      kind: dto.kind, name: dto.name, description: dto.description ?? null, imageUrl: dto.imageUrl ?? null,
      latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
      // Day numbers only mean something on a place itinerary.
      dayNumber: guideKind === GuideKind.DESTINATION ? dto.dayNumber ?? 1 : null,
      distanceFromStartKm: dto.distanceFromStartKm ?? null, minutesFromStart: dto.minutesFromStart ?? null,
      priceFromNpr: dto.priceFromNpr ?? null, openingHours: dto.openingHours ?? null,
      contactPhone: dto.contactPhone ?? null, tip: dto.tip ?? null,
      placeId: dto.placeId ?? null, businessId: dto.businessId ?? null,
      isHighlight: dto.isHighlight ?? false,
    };
  }

  /** A guide belongs to a route or to a destination, never both and never neither. */
  private async checkedTarget(dto: SaveGuideDto) {
    if (dto.kind === GuideKind.ROUTE) {
      if (!dto.routeId) throw new BadRequestException('Choose the route this guide covers.');
      const route = await this.prisma.route.findUnique({ where: { id: dto.routeId }, select: { id: true } });
      if (!route) throw new BadRequestException('Choose a route from the list.');
      return { routeId: dto.routeId, destinationId: null };
    }
    if (!dto.destinationId) throw new BadRequestException('Choose the place this itinerary covers.');
    const destination = await this.prisma.destination.findUnique({ where: { id: dto.destinationId }, select: { id: true } });
    if (!destination) throw new BadRequestException('Choose a place from the list.');
    return { routeId: null, destinationId: dto.destinationId };
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
