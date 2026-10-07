import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Event, EventStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import { uniqueSlug } from '../../common/utils/slug.util';
import { EventListQueryDto, SaveEventDto } from './dto/event.dto';
import { eventTimes, over, stillOn } from './events.util';

const LIST = {
  id: true, slug: true, title: true, summary: true, category: true, city: true, venue: true,
  startsAt: true, endsAt: true, allDay: true, status: true, isFeatured: true, imageUrl: true,
  publishedAt: true, updatedAt: true, createdBy: { select: { name: true } },
} satisfies Prisma.EventSelect;

const STATUS_WORD: Record<EventStatus, string> = { DRAFT: 'a draft', PUBLISHED: 'published', CANCELLED: 'cancelled' };

/** Events and happenings for the website, added and edited by editors and admins. */
@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private config: ConfigService) {}

  async list(q: EventListQueryDto) {
    const when = q.when ?? 'upcoming';
    const where: Prisma.EventWhereInput = {
      AND: [
        when === 'upcoming' ? stillOn() : when === 'past' ? over() : {},
        q.status ? { status: q.status } : {},
        q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { city: { contains: q.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const [items, cities] = await Promise.all([
      this.prisma.event.findMany({ where, select: LIST, orderBy: { startsAt: when === 'past' ? 'desc' : 'asc' }, take: 300 }),
      this.prisma.event.findMany({ distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } }),
    ]);
    return { items, cities: cities.map((c) => c.city) };
  }

  async get(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id }, include: { createdBy: { select: { name: true } } } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async create(dto: SaveEventDto, actorId: string, ip?: string) {
    const data = await this.eventData(dto);
    const slug = await uniqueSlug(`${dto.title} ${data.startsAt.toISOString().slice(0, 4)}`, async (s) =>
      !!(await this.prisma.event.findUnique({ where: { slug: s }, select: { id: true } })),
    );
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: { ...data, slug, createdById: actorId, publishedAt: data.status === EventStatus.DRAFT ? null : new Date() },
      });
      await this.audit.record({
        actorId, ip, action: 'event.create', entityType: 'Event', entityId: event.id,
        summary: `Added the event ${event.title} in ${event.city} (${STATUS_WORD[event.status]})`, after: event,
      }, tx);
      return event;
    });
  }

  async update(id: string, dto: SaveEventDto, actorId: string, ip?: string) {
    const before = await this.get(id);
    const data = await this.eventData(dto);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.event.update({
        where: { id },
        // The address (slug) stays the same once made, so shared links keep working.
        data: { ...data, publishedAt: before.publishedAt ?? (data.status === EventStatus.DRAFT ? null : new Date()) },
      });
      await this.audit.record({
        actorId, ip, action: 'event.update', entityType: 'Event', entityId: id,
        summary: before.status === after.status
          ? `Edited the event ${after.title}`
          : `Made the event ${after.title} ${STATUS_WORD[after.status]}`,
        before: strip(before), after,
      }, tx);
      return after;
    });
  }

  async remove(id: string, actorId: string, ip?: string) {
    const before = await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.event.delete({ where: { id } });
      await this.audit.record({
        actorId, ip, action: 'event.delete', entityType: 'Event', entityId: id,
        summary: `Removed the event ${before.title}`, before: strip(before),
      }, tx);
    });
    return { deleted: true };
  }

  /** Checks a form: times in order, a real place, and pictures uploaded through Batoma. */
  private async eventData(dto: SaveEventDto) {
    const allDay = dto.allDay ?? false;
    const { startsAt, endsAt } = eventTimes(dto.startsAt, dto.endsAt, allDay);
    if (endsAt && endsAt < startsAt) throw new BadRequestException('The event must end after it starts.');
    if (endsAt && endsAt.getTime() - startsAt.getTime() > 92 * 86_400_000) {
      throw new BadRequestException('An event can run for three months at most. Add longer seasons as separate events.');
    }
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if (dto.imageUrl && !isOwnMediaUrl(dto.imageUrl, base)) throw new BadRequestException('Upload the picture through Batoma.');
    if (dto.destinationId) {
      const place = await this.prisma.destination.findUnique({ where: { id: dto.destinationId }, select: { id: true } });
      if (!place) throw new BadRequestException('That place no longer exists. Choose another.');
    }
    return {
      title: dto.title, titleNe: dto.titleNe ?? null, summary: dto.summary, description: dto.description ?? null,
      category: dto.category, city: dto.city, venue: dto.venue ?? null, address: dto.address ?? null,
      destinationId: dto.destinationId ?? null, startsAt, endsAt, allDay,
      priceLabel: dto.priceLabel ?? null, organiser: dto.organiser ?? null, url: dto.url ?? null,
      imageUrl: dto.imageUrl ?? null, status: dto.status ?? EventStatus.DRAFT, isFeatured: dto.isFeatured ?? false,
    };
  }
}

/** The audit log keeps the event, not who added it (that is the actor already). */
function strip(e: Event & { createdBy?: unknown }) {
  const { createdBy: _ignored, ...rest } = e;
  return rest;
}
