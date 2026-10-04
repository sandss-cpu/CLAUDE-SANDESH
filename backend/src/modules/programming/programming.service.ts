import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ContentPlacement, ContentStatus, GuideDirection, PlacementScope, Prisma, RouteNotice,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { Candidate, contentFor, Direction, Placed } from './content-for';
import {
  AssignRoutesDto, CopyDirectionDto, CreatePlacementDto, HistoryQueryDto, PreviewQueryDto,
  ReorderPlacementsDto, SaveNoticeDto, SlotQueryDto, UpdatePlacementDto,
} from './dto/programming.dto';

/** What a reader needs to list a story, plus what ordering and the offline pack need. */
export const PROGRAMME_CARD = {
  id: true, slug: true, title: true, subtitle: true, coverImageUrl: true, audioUrl: true,
  readMinutes: true, isSponsored: true, isFeatured: true, publishedAt: true, updatedAt: true,
  category: { select: { slug: true, name: true, colorHex: true } },
} satisfies Prisma.ArticleSelect;

type Card = Prisma.ArticleGetPayload<{ select: typeof PROGRAMME_CARD }>;

const PLACEMENT_FIELDS = {
  id: true, scope: true, routeId: true, operatorId: true, vehicleId: true, direction: true,
  position: true, isPinned: true, startsAt: true, endsAt: true, daysOfWeek: true,
  timeFrom: true, timeTo: true, updatedAt: true,
} satisfies Prisma.ContentPlacementSelect;

export interface ProgrammeContext {
  vehicleId?: string | null;
  operatorId?: string | null;
  routeId?: string | null;
  direction?: Direction | null;
  at?: Date;
}

interface Slot {
  scope: PlacementScope;
  routeId: string | null;
  operatorId: string | null;
  vehicleId: string | null;
  direction: GuideDirection;
}

const DIRECTION_LABEL: Record<GuideDirection, string> = { BOTH: 'both ways', FORWARD: 'outbound', REVERSE: 'return' };
const opposite = (d: 'FORWARD' | 'REVERSE'): GuideDirection => (d === 'FORWARD' ? 'REVERSE' : 'FORWARD');

@Injectable()
export class ProgrammingService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // =================================================================== reading

  /**
   * The programme for one bus at one moment: the hottest query in the system after
   * the scan itself, so it is two indexed reads and the rest happens in memory.
   */
  async programmeFor(ctx: ProgrammeContext) {
    const at = ctx.at ?? new Date();
    const targets: Prisma.ContentPlacementWhereInput[] = [{ scope: PlacementScope.DEFAULT }];
    if (ctx.routeId) targets.push({ scope: PlacementScope.ROUTE, routeId: ctx.routeId });
    if (ctx.operatorId) targets.push({ scope: PlacementScope.OPERATOR, operatorId: ctx.operatorId });
    if (ctx.vehicleId) targets.push({ scope: PlacementScope.VEHICLE, vehicleId: ctx.vehicleId });

    const [placements, issue] = await Promise.all([
      this.prisma.contentPlacement.findMany({
        where: {
          OR: targets,
          article: { status: ContentStatus.PUBLISHED },
          // Expired and future placements never leave the database.
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: at } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: at } }] },
          ],
        },
        select: { ...PLACEMENT_FIELDS, article: { select: PROGRAMME_CARD } },
      }),
      this.currentIssue(),
    ]);

    const programme = contentFor<Card>(placements as Candidate<Card>[], issue?.articles ?? [], {
      vehicleId: ctx.vehicleId, operatorId: ctx.operatorId, routeId: ctx.routeId,
      direction: ctx.direction ?? null, at,
    });
    const all = [programme.lead, ...programme.stories, ...programme.more].filter(Boolean) as Placed<Card>[];
    const latestPlacement = placements.reduce((m, p) => Math.max(m, p.updatedAt.getTime()), 0);
    return {
      ...programme,
      issue: issue ? { id: issue.id, number: issue.number, title: issue.title, strapline: issue.strapline, coverImageUrl: issue.coverImageUrl } : null,
      /**
       * Changes whenever what this bus shows changes: a story added, moved, edited or
       * removed. The reader compares it with what its offline pack was built from, so
       * a stale pack is refetched the next time there is signal and an unchanged one
       * is not downloaded again.
       */
      version: createHash('sha1')
        .update(`${ctx.direction ?? 'BOTH'}|${latestPlacement}|`)
        .update(all.map((p) => `${p.article.id}:${new Date(p.article.updatedAt).getTime()}`).join(','))
        .digest('hex').slice(0, 16),
    };
  }

  private currentIssue() {
    return this.prisma.issue.findFirst({
      where: { status: ContentStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true, number: true, title: true, strapline: true, coverImageUrl: true,
        articles: {
          where: { status: ContentStatus.PUBLISHED },
          select: PROGRAMME_CARD,
          orderBy: [{ isFeatured: 'desc' }, { publishedAt: 'desc' }],
          take: 40,
        },
      },
    });
  }

  /** Road alerts for this route and direction that are on now, most serious first. */
  async noticesFor(routeId: string | null | undefined, direction: Direction | null | undefined, at = new Date()) {
    if (!routeId) return [];
    const notices = await this.prisma.routeNotice.findMany({
      where: {
        routeId,
        startsAt: { lte: at },
        OR: [{ endsAt: null }, { endsAt: { gt: at } }],
        direction: { in: direction ? [GuideDirection.BOTH, direction] : [GuideDirection.BOTH] },
      },
      select: {
        id: true, severity: true, direction: true, title: true, titleNe: true,
        body: true, bodyNe: true, startsAt: true, endsAt: true,
      },
      orderBy: { startsAt: 'desc' },
    });
    const weight = { DANGER: 0, WARNING: 1, INFO: 2 } as const;
    return notices.sort((a, b) => weight[a.severity] - weight[b.severity]);
  }

  // =================================================================== admin: lists

  /** The placements in one list, in order, with enough of each article to show it. */
  async list(q: SlotQueryDto) {
    const slot = await this.checkedSlot(q);
    const items = await this.prisma.contentPlacement.findMany({
      where: this.slotWhere(slot),
      select: {
        ...PLACEMENT_FIELDS, createdAt: true,
        article: { select: { id: true, slug: true, title: true, status: true, readMinutes: true, category: { select: { name: true } } } },
      },
      orderBy: [{ isPinned: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
    return { slot, items };
  }

  /** Buses on a route, grouped by company, for narrowing a list to one company or bus. */
  async routeBuses(routeId: string) {
    const buses = await this.prisma.vehicle.findMany({
      where: { routeId, isActive: true },
      select: {
        id: true, plateNo: true, label: true,
        operator: { select: { id: true, name: true, verification: true } },
      },
      orderBy: [{ operator: { name: 'asc' } }, { plateNo: 'asc' }],
    });
    const companies = new Map<string, { id: string; name: string; verification: string; buses: Array<{ id: string; plateNo: string; label: string | null }> }>();
    for (const b of buses) {
      const c = companies.get(b.operator.id) ?? { ...b.operator, buses: [] };
      c.buses.push({ id: b.id, plateNo: b.plateNo, label: b.label });
      companies.set(b.operator.id, c);
    }
    return [...companies.values()];
  }

  /** Exactly what the reader would show for this bus, direction and moment. */
  async preview(q: PreviewQueryDto) {
    const at = q.at ? new Date(q.at) : new Date();
    let { routeId, operatorId } = q;
    if (q.vehicleId) {
      const bus = await this.prisma.vehicle.findUnique({ where: { id: q.vehicleId }, select: { routeId: true, operatorId: true } });
      if (!bus) throw new NotFoundException('Bus not found');
      routeId = routeId ?? bus.routeId ?? undefined;
      operatorId = operatorId ?? bus.operatorId;
    }
    const direction = q.direction === 'FORWARD' || q.direction === 'REVERSE' ? q.direction : null;
    const [programme, notices] = await Promise.all([
      this.programmeFor({ vehicleId: q.vehicleId, operatorId, routeId, direction, at }),
      this.noticesFor(routeId, direction, at),
    ]);
    const view = (p: Placed<Card> | null) => p && {
      level: p.level, placementId: p.placementId, isPinned: p.isPinned,
      article: { id: p.article.id, slug: p.article.slug, title: p.article.title, readMinutes: p.article.readMinutes, category: p.article.category },
    };
    return {
      at, context: { routeId: routeId ?? null, operatorId: operatorId ?? null, vehicleId: q.vehicleId ?? null, direction },
      lead: view(programme.lead), stories: programme.stories.map(view), more: programme.more.map(view),
      notices, version: programme.version,
    };
  }

  /** Who changed a route's programme or notices, and when. */
  async history(q: HistoryQueryDto) {
    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: { in: ['ContentPlacement', 'RouteNotice'] },
        ...(q.routeId ? { routeId: q.routeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.take ?? 50,
      select: { id: true, action: true, summary: true, actorId: true, createdAt: true },
    });
    const actorIds = [...new Set(events.map((e) => e.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    return events.map((e) => ({ ...e, actor: e.actorId ? byId.get(e.actorId) ?? null : null }));
  }

  // =================================================================== admin: changes

  async create(dto: CreatePlacementDto, actorId: string, ip?: string) {
    const slot = await this.checkedSlot(dto);
    const article = await this.prisma.article.findUnique({ where: { id: dto.articleId }, select: { id: true, title: true } });
    if (!article) throw new NotFoundException('Article not found');
    const schedule = this.checkedSchedule(dto);

    const placement = await this.prisma.$transaction(async (tx) => {
      const last = await tx.contentPlacement.aggregate({ where: this.slotWhere(slot), _max: { position: true } });
      if (dto.isPinned) await tx.contentPlacement.updateMany({ where: this.slotWhere(slot), data: { isPinned: false } });
      const created = await this.inSlot(() => tx.contentPlacement.create({
        data: {
          articleId: article.id, ...slot, ...schedule, isPinned: !!dto.isPinned,
          position: (last._max.position ?? -1) + 1, createdById: actorId,
        },
      }));
      await this.audit.record({
        actorId, ip, action: 'placement.create', entityType: 'ContentPlacement', entityId: created.id,
        summary: `Added "${article.title}" to ${await this.describe(slot, tx)}${dto.isPinned ? ' as the lead' : ''}`,
        after: created, routeId: slot.routeId, operatorId: slot.operatorId,
      }, tx);
      return created;
    });
    return placement;
  }

  async update(id: string, dto: UpdatePlacementDto, actorId: string, ip?: string) {
    const before = await this.placementOrThrow(id);
    const merged = { ...before, ...this.definedOnly(dto) };
    const schedule = this.checkedSchedule(merged);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isPinned) {
        await tx.contentPlacement.updateMany({ where: { ...this.slotWhere(before), id: { not: id } }, data: { isPinned: false } });
      }
      const after = await tx.contentPlacement.update({
        where: { id },
        data: { ...schedule, ...(dto.isPinned !== undefined ? { isPinned: dto.isPinned } : {}) },
      });
      const what = dto.isPinned === true ? 'Made the lead'
        : dto.isPinned === false && before.isPinned ? 'Unpinned' : 'Rescheduled';
      await this.audit.record({
        actorId, ip, action: 'placement.update', entityType: 'ContentPlacement', entityId: id,
        summary: `${what}: "${before.article.title}" in ${await this.describe(before, tx)}`,
        before: this.plain(before), after, routeId: before.routeId, operatorId: before.operatorId,
      }, tx);
      return after;
    });
  }

  async remove(id: string, actorId: string, ip?: string) {
    const before = await this.placementOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.contentPlacement.delete({ where: { id } });
      await this.audit.record({
        actorId, ip, action: 'placement.delete', entityType: 'ContentPlacement', entityId: id,
        summary: `Removed "${before.article.title}" from ${await this.describe(before, tx)}`,
        before: this.plain(before), routeId: before.routeId, operatorId: before.operatorId,
      }, tx);
    });
    return { deleted: true };
  }

  /** New order for one list: every id must belong to the same list. */
  async reorder(dto: ReorderPlacementsDto, actorId: string, ip?: string) {
    const rows = await this.prisma.contentPlacement.findMany({
      where: { id: { in: dto.ids } },
      select: { id: true, scope: true, routeId: true, operatorId: true, vehicleId: true, direction: true },
    });
    if (rows.length !== dto.ids.length) throw new NotFoundException('Some of these placements no longer exist. Reload the list.');
    const key = (r: Slot) => [r.scope, r.routeId, r.operatorId, r.vehicleId, r.direction].join('|');
    if (new Set(rows.map(key)).size !== 1) throw new BadRequestException('Reorder one list at a time.');
    const slot = rows[0] as Slot;
    const inList = await this.prisma.contentPlacement.count({ where: this.slotWhere(slot) });
    if (inList !== dto.ids.length) throw new BadRequestException('The list has changed since it was loaded. Reload it and try again.');

    await this.prisma.$transaction(async (tx) => {
      for (const [position, id] of dto.ids.entries()) {
        await tx.contentPlacement.update({ where: { id }, data: { position } });
      }
      await this.audit.record({
        actorId, ip, action: 'placement.reorder', entityType: 'ContentPlacement',
        summary: `Reordered ${await this.describe(slot, tx)}`,
        after: { order: dto.ids }, routeId: slot.routeId, operatorId: slot.operatorId,
      }, tx);
    });
    return { reordered: dto.ids.length };
  }

  /** Puts one direction's list on the return leg too, skipping stories already there. */
  async copyDirection(dto: CopyDirectionDto, actorId: string, ip?: string) {
    const from = await this.checkedSlot({ ...dto, direction: dto.from });
    const to: Slot = { ...from, direction: opposite(dto.from) };
    const [source, existing] = await Promise.all([
      this.prisma.contentPlacement.findMany({ where: this.slotWhere(from), orderBy: { position: 'asc' } }),
      this.prisma.contentPlacement.findMany({ where: this.slotWhere(to), select: { articleId: true, isPinned: true, position: true } }),
    ]);
    const already = new Set(existing.map((p) => p.articleId));
    const hasLead = existing.some((p) => p.isPinned);
    let next = existing.reduce((m, p) => Math.max(m, p.position), -1) + 1;
    const copies = source.filter((p) => !already.has(p.articleId));

    await this.prisma.$transaction(async (tx) => {
      for (const p of copies) {
        await tx.contentPlacement.create({
          data: {
            articleId: p.articleId, ...to, position: next++, isPinned: p.isPinned && !hasLead,
            startsAt: p.startsAt, endsAt: p.endsAt, daysOfWeek: p.daysOfWeek, timeFrom: p.timeFrom, timeTo: p.timeTo,
            createdById: actorId,
          },
        });
      }
      await this.audit.record({
        actorId, ip, action: 'placement.copy-direction', entityType: 'ContentPlacement',
        summary: `Copied ${copies.length} ${copies.length === 1 ? 'story' : 'stories'} from ${await this.describe(from, tx)} to the ${DIRECTION_LABEL[to.direction]} list`,
        after: { articleIds: copies.map((p) => p.articleId) }, routeId: from.routeId, operatorId: from.operatorId,
      }, tx);
    });
    return { copied: copies.length, skipped: source.length - copies.length };
  }

  /** One article onto several routes at once; routes that already carry it are left alone. */
  async assignRoutes(dto: AssignRoutesDto, actorId: string, ip?: string) {
    const direction = dto.direction ?? GuideDirection.BOTH;
    const [article, routes] = await Promise.all([
      this.prisma.article.findUnique({ where: { id: dto.articleId }, select: { id: true, title: true } }),
      this.prisma.route.findMany({ where: { id: { in: dto.routeIds } }, select: { id: true, name: true } }),
    ]);
    if (!article) throw new NotFoundException('Article not found');
    if (routes.length !== dto.routeIds.length) throw new BadRequestException('Choose routes from the list.');

    let added = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const route of routes) {
        const slot: Slot = { scope: PlacementScope.ROUTE, routeId: route.id, operatorId: null, vehicleId: null, direction };
        const there = await tx.contentPlacement.findFirst({ where: { ...this.slotWhere(slot), articleId: article.id }, select: { id: true } });
        if (there) continue;
        const last = await tx.contentPlacement.aggregate({ where: this.slotWhere(slot), _max: { position: true } });
        const created = await tx.contentPlacement.create({
          data: { articleId: article.id, ...slot, position: (last._max.position ?? -1) + 1, createdById: actorId },
        });
        added += 1;
        await this.audit.record({
          actorId, ip, action: 'placement.create', entityType: 'ContentPlacement', entityId: created.id,
          summary: `Added "${article.title}" to ${route.name} (${DIRECTION_LABEL[direction]})`,
          after: created, routeId: route.id,
        }, tx);
      }
    });
    return { added, skipped: routes.length - added };
  }

  // =================================================================== notices

  listNotices(routeId?: string) {
    return this.prisma.routeNotice.findMany({
      where: routeId ? { routeId } : {},
      include: { route: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: 'desc' }],
      take: 200,
    });
  }

  async createNotice(dto: SaveNoticeDto, actorId: string, ip?: string) {
    const route = await this.routeOrThrow(dto.routeId);
    const data = this.noticeData(dto);
    return this.prisma.$transaction(async (tx) => {
      const notice = await tx.routeNotice.create({ data: { ...data, routeId: route.id, createdById: actorId } });
      await this.audit.record({
        actorId, ip, action: 'notice.create', entityType: 'RouteNotice', entityId: notice.id,
        summary: `Posted a ${notice.severity.toLowerCase()} notice on ${route.name}: "${notice.title}"`,
        after: notice, routeId: route.id,
      }, tx);
      return notice;
    });
  }

  async updateNotice(id: string, dto: SaveNoticeDto, actorId: string, ip?: string) {
    const before = await this.noticeOrThrow(id);
    const route = await this.routeOrThrow(dto.routeId);
    const data = this.noticeData(dto);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.routeNotice.update({ where: { id }, data: { ...data, routeId: route.id } });
      await this.audit.record({
        actorId, ip, action: 'notice.update', entityType: 'RouteNotice', entityId: id,
        summary: `Edited the notice "${after.title}" on ${route.name}`,
        before, after, routeId: route.id,
      }, tx);
      return after;
    });
  }

  async removeNotice(id: string, actorId: string, ip?: string) {
    const before = await this.noticeOrThrow(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.routeNotice.delete({ where: { id } });
      await this.audit.record({
        actorId, ip, action: 'notice.delete', entityType: 'RouteNotice', entityId: id,
        summary: `Removed the notice "${before.title}"`, before, routeId: before.routeId,
      }, tx);
    });
    return { deleted: true };
  }

  // =================================================================== helpers

  /** Turns "route, then optionally a company or a bus" into one list, checking every id exists. */
  private async checkedSlot(q: SlotQueryDto): Promise<Slot> {
    const direction = q.direction ?? GuideDirection.BOTH;
    if (q.vehicleId) {
      const bus = await this.prisma.vehicle.findUnique({ where: { id: q.vehicleId }, select: { id: true } });
      if (!bus) throw new NotFoundException('Bus not found');
      if (q.routeId) await this.routeOrThrow(q.routeId);
      return { scope: PlacementScope.VEHICLE, routeId: q.routeId ?? null, operatorId: null, vehicleId: q.vehicleId, direction };
    }
    if (q.operatorId) {
      const company = await this.prisma.operator.findUnique({ where: { id: q.operatorId }, select: { id: true } });
      if (!company) throw new NotFoundException('Company not found');
      if (q.routeId) await this.routeOrThrow(q.routeId);
      return { scope: PlacementScope.OPERATOR, routeId: q.routeId ?? null, operatorId: q.operatorId, vehicleId: null, direction };
    }
    if (q.routeId) {
      await this.routeOrThrow(q.routeId);
      return { scope: PlacementScope.ROUTE, routeId: q.routeId, operatorId: null, vehicleId: null, direction };
    }
    if (direction !== GuideDirection.BOTH) {
      throw new BadRequestException('The list every bus falls back to has no direction. Choose a route first.');
    }
    return { scope: PlacementScope.DEFAULT, routeId: null, operatorId: null, vehicleId: null, direction };
  }

  private slotWhere(slot: Slot): Prisma.ContentPlacementWhereInput {
    return {
      scope: slot.scope, routeId: slot.routeId, operatorId: slot.operatorId,
      vehicleId: slot.vehicleId, direction: slot.direction,
    };
  }

  /** Validates dates and the daily window together, since each only makes sense with the other. */
  private checkedSchedule(s: {
    startsAt?: string | Date | null; endsAt?: string | Date | null;
    daysOfWeek?: number[]; timeFrom?: string | null; timeTo?: string | null;
  }) {
    const startsAt = s.startsAt ? new Date(s.startsAt) : null;
    const endsAt = s.endsAt ? new Date(s.endsAt) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('The end must be after the start.');
    const timeFrom = s.timeFrom || null;
    const timeTo = s.timeTo || null;
    if (!!timeFrom !== !!timeTo) throw new BadRequestException('Give both a from and a to time, or neither.');
    if (timeFrom && timeFrom === timeTo) throw new BadRequestException('The from and to times are the same.');
    return { startsAt, endsAt, timeFrom, timeTo, daysOfWeek: [...new Set(s.daysOfWeek ?? [])].sort() };
  }

  private definedOnly<T extends object>(dto: T): Partial<T> {
    return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
  }

  private plain(p: ContentPlacement & { article?: unknown }) {
    const { article: _article, ...rest } = p;
    return rest;
  }

  /** The placement_slot index is not visible to Prisma, so its clash is translated here. */
  private async inSlot<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        throw new ConflictException('That story is already in this list.');
      }
      throw e;
    }
  }

  private async describe(slot: Slot, tx: Prisma.TransactionClient = this.prisma) {
    const [route, company, bus] = await Promise.all([
      slot.routeId ? tx.route.findUnique({ where: { id: slot.routeId }, select: { name: true } }) : null,
      slot.operatorId ? tx.operator.findUnique({ where: { id: slot.operatorId }, select: { name: true } }) : null,
      slot.vehicleId ? tx.vehicle.findUnique({ where: { id: slot.vehicleId }, select: { plateNo: true } }) : null,
    ]);
    const where = [
      bus ? `bus ${bus.plateNo}` : company ? company.name : null,
      route ? route.name : slot.scope === PlacementScope.DEFAULT ? 'the list for every bus' : 'every route',
    ].filter(Boolean).join(', ');
    return slot.scope === PlacementScope.DEFAULT ? where : `${where} (${DIRECTION_LABEL[slot.direction]})`;
  }

  private async placementOrThrow(id: string) {
    const p = await this.prisma.contentPlacement.findUnique({ where: { id }, include: { article: { select: { title: true } } } });
    if (!p) throw new NotFoundException('That placement no longer exists.');
    return p;
  }

  private async routeOrThrow(id: string) {
    const route = await this.prisma.route.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!route) throw new NotFoundException('Route not found');
    return route;
  }

  private async noticeOrThrow(id: string): Promise<RouteNotice> {
    const n = await this.prisma.routeNotice.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('That notice no longer exists.');
    return n;
  }

  private noticeData(dto: SaveNoticeDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('The notice must end after it starts.');
    return {
      direction: dto.direction ?? GuideDirection.BOTH, severity: dto.severity ?? 'INFO',
      title: dto.title, titleNe: dto.titleNe ?? null, body: dto.body ?? null, bodyNe: dto.bodyNe ?? null,
      startsAt, endsAt,
    };
  }
}
