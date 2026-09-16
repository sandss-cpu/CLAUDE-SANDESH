import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdDurationUnit, AdLinkType, AdPlacement, Advertisement, ModerationAct, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import { AdStatus, SaveAdDto } from './dto/ads.dto';

const DAY_MS = 86_400_000;

const PUBLIC_AD = {
  id: true, title: true, advertiserName: true, tagline: true, imageUrl: true,
  placement: true, linkType: true, externalUrl: true,
} satisfies Prisma.AdvertisementSelect;

/**
 * Calendar months for MONTH. A plain setMonth turns "31 Jan + 1 month" into
 * 3 March, because 31 February rolls over; the day is clamped to the last day
 * of the target month instead, so an advertiser buying a month gets that month.
 */
export function computeEndsAt(start: Date, unit: AdDurationUnit, count: number): Date {
  if (unit !== AdDurationUnit.MONTH) {
    return new Date(start.getTime() + count * (unit === AdDurationUnit.WEEK ? 7 : 1) * DAY_MS);
  }
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export function adStatus(ad: Pick<Advertisement, 'isActive' | 'startsAt' | 'endsAt'>, now = new Date()): AdStatus {
  if (ad.endsAt <= now) return 'EXPIRED';
  if (!ad.isActive) return 'PAUSED';
  if (ad.startsAt > now) return 'SCHEDULED';
  return 'ACTIVE';
}

function liveWhere(now = new Date()): Prisma.AdvertisementWhereInput {
  return { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } };
}

@Injectable()
export class AdsService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  // ---------------- public slots ----------------

  /**
   * Least-shown first, so several advertisers booked on one slot share the exposure.
   *
   * An ad aimed at the traveller's corridor wins the slot ahead of one with no
   * targeting; ads aimed at *other* routes never appear. With no route known
   * (off a bus, or a general screen), only untargeted ads show.
   */
  async slot(placement: AdPlacement, limit = 1, routeId?: string) {
    const order: Prisma.AdvertisementOrderByWithRelationInput[] = [{ impressions: 'asc' }, { startsAt: 'asc' }];
    const untargeted = { placement, ...liveWhere(), routeTargets: { none: {} } };

    if (!routeId) {
      return this.prisma.advertisement.findMany({ where: untargeted, select: PUBLIC_AD, orderBy: order, take: limit });
    }

    const targeted = await this.prisma.advertisement.findMany({
      where: { placement, ...liveWhere(), routeTargets: { some: { routeId } } },
      select: PUBLIC_AD, orderBy: order, take: limit,
    });
    if (targeted.length >= limit) return targeted;

    const fill = await this.prisma.advertisement.findMany({
      where: untargeted, select: PUBLIC_AD, orderBy: order, take: limit - targeted.length,
    });
    return [...targeted, ...fill];
  }

  async recordImpressions(ids: string[]) {
    const { count } = await this.prisma.advertisement.updateMany({
      where: { id: { in: [...new Set(ids)] }, ...liveWhere() },
      data: { impressions: { increment: 1 } },
    });
    return { recorded: count };
  }

  /** Counts the click and tells the client where to send the reader. */
  async click(id: string) {
    const ad = await this.prisma.advertisement.findFirst({
      where: { id, ...liveWhere() },
      select: { id: true, linkType: true, externalUrl: true },
    });
    if (!ad) throw new NotFoundException('This offer has ended');
    await this.prisma.advertisement.update({ where: { id }, data: { clicks: { increment: 1 } } });
    return ad.linkType === AdLinkType.EXTERNAL
      ? { linkType: ad.linkType, url: ad.externalUrl }
      : { linkType: ad.linkType, id: ad.id };
  }

  async overview(id: string) {
    const ad = await this.prisma.advertisement.findFirst({
      where: { id, linkType: AdLinkType.OVERVIEW, ...liveWhere() },
      select: {
        id: true, title: true, advertiserName: true, tagline: true, imageUrl: true,
        overviewTitle: true, overviewBody: true, overviewImageUrl: true, endsAt: true,
        business: {
          select: { slug: true, name: true, category: true, district: true, phone: true, website: true },
        },
      },
    });
    if (!ad) throw new NotFoundException('This offer has ended');
    return ad;
  }

  // ---------------- admin ----------------

  async adminList(status?: AdStatus) {
    const now = new Date();
    const where: Prisma.AdvertisementWhereInput =
      status === 'ACTIVE' ? liveWhere(now)
      : status === 'SCHEDULED' ? { isActive: true, startsAt: { gt: now }, endsAt: { gt: now } }
      : status === 'EXPIRED' ? { endsAt: { lte: now } }
      : status === 'PAUSED' ? { isActive: false, endsAt: { gt: now } }
      : {};

    const ads = await this.prisma.advertisement.findMany({
      where,
      include: {
        business: { select: { id: true, name: true, slug: true } },
        routeTargets: { include: { route: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: [{ endsAt: 'desc' }],
    });

    return ads.map(({ routeTargets, ...ad }) => ({
      ...ad,
      routes: routeTargets.map((t) => t.route),
      routeIds: routeTargets.map((t) => t.routeId),
      status: adStatus(ad, now),
      daysLeft: Math.max(0, Math.ceil((ad.endsAt.getTime() - now.getTime()) / DAY_MS)),
      ctr: ad.impressions ? +((ad.clicks / ad.impressions) * 100).toFixed(1) : 0,
    }));
  }

  async create(dto: SaveAdDto, actorId: string) {
    const data = this.toData(dto, true);
    await this.assertRoutes(dto.routeIds);
    const ad = await this.prisma.advertisement.create({
      data: {
        ...data, createdById: actorId,
        routeTargets: dto.routeIds?.length ? { create: dto.routeIds.map((routeId) => ({ routeId })) } : undefined,
      },
    });
    await this.audit(actorId, ad.id, ModerationAct.CREATE, `${ad.placement} · ${ad.advertiserName}`);
    return ad;
  }

  async update(id: string, dto: SaveAdDto, actorId: string) {
    await this.findOrThrow(id);
    await this.assertRoutes(dto.routeIds);
    const ad = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.advertisement.update({ where: { id }, data: this.toData(dto, false) });
      // The form always submits the whole targeting list, so replace it wholesale.
      if (dto.routeIds) {
        await tx.adRouteTarget.deleteMany({ where: { adId: id } });
        if (dto.routeIds.length) {
          await tx.adRouteTarget.createMany({ data: dto.routeIds.map((routeId) => ({ adId: id, routeId })) });
        }
      }
      return saved;
    });
    await this.audit(actorId, id, ModerationAct.UPDATE);
    return ad;
  }

  private async assertRoutes(routeIds?: string[]) {
    if (!routeIds?.length) return;
    const found = await this.prisma.route.count({ where: { id: { in: routeIds } } });
    if (found !== new Set(routeIds).size) throw new BadRequestException('Choose routes from the list.');
  }

  async setActive(id: string, isActive: boolean, actorId: string) {
    await this.findOrThrow(id);
    const ad = await this.prisma.advertisement.update({ where: { id }, data: { isActive } });
    await this.audit(actorId, id, isActive ? ModerationAct.RESUME : ModerationAct.PAUSE);
    return ad;
  }

  async remove(id: string, actorId: string) {
    const ad = await this.findOrThrow(id);
    await this.prisma.$transaction([
      this.prisma.advertisement.delete({ where: { id } }),
      this.prisma.moderationEntry.create({
        data: {
          moderatorId: actorId, targetType: 'AD', targetId: id, action: ModerationAct.DELETE,
          note: `${ad.title} · ${ad.advertiserName}`,
        },
      }),
    ]);
    return { deleted: true };
  }

  private async findOrThrow(id: string) {
    const ad = await this.prisma.advertisement.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found');
    return ad;
  }

  private audit(actorId: string, adId: string, action: ModerationAct, note?: string) {
    return this.prisma.moderationEntry.create({
      data: { moderatorId: actorId, targetType: 'AD', targetId: adId, action, note },
    });
  }

  /** Validation that needs more than a decorator, and the link fields that don't apply cleared out. */
  private toData(dto: SaveAdDto, isNew: boolean) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if (!isOwnMediaUrl(dto.imageUrl, base)) {
      throw new BadRequestException('Upload the ad image through Bato.');
    }
    if (dto.overviewImageUrl && !isOwnMediaUrl(dto.overviewImageUrl, base)) {
      throw new BadRequestException('Upload the overview image through Bato.');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    if (isNew && startsAt.getTime() < Date.now() - DAY_MS) {
      throw new BadRequestException("Start date can't be in the past");
    }

    const external = dto.linkType === AdLinkType.EXTERNAL;
    return {
      title: dto.title.trim(),
      advertiserName: dto.advertiserName.trim(),
      tagline: dto.tagline?.trim() || null,
      imageUrl: dto.imageUrl,
      placement: dto.placement,
      durationUnit: dto.durationUnit,
      durationCount: dto.durationCount,
      startsAt,
      endsAt: computeEndsAt(startsAt, dto.durationUnit, dto.durationCount),
      linkType: dto.linkType,
      externalUrl: external ? dto.externalUrl : null,
      overviewTitle: external ? null : dto.overviewTitle?.trim(),
      overviewBody: external ? null : dto.overviewBody?.trim() || null,
      overviewImageUrl: external ? null : dto.overviewImageUrl || null,
      businessId: dto.businessId || null,
    };
  }
}
