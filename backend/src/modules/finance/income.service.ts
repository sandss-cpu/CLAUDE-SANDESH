import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { IncomeEntry, IncomeSourceKind, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotAnImageError, reencode } from '../../common/media/images';
import { formatBs } from '../../common/utils/bs-date';
import { addDays, DAY_RE, ktmDayStart, ktmToday } from '../../common/utils/ktm-period';
import { MfaService } from '../auth/mfa.service';
import { FinanceSettingsDto, SaveSheetDto, SheetRowDto, SourceDto, UpdateSourceDto } from './dto/finance.dto';
import { FleetAccessService } from '../fleet/fleet-access.service';
import { FinanceAccessService } from './finance-access.service';
import { formatPaisa } from './money';

/** Entries can be corrected for a week after they are made; after that they are the record. */
export const LOCK_AFTER_MS = 7 * 86_400_000;

/** The sources every company starts with, in the order the daily sheet shows them. */
export const DEFAULT_SOURCES: Array<[string, IncomeSourceKind]> = [
  ['Counter cash', 'CASH'], ['On-board cash', 'CASH'], ['Bussewa', 'PORTAL'], ['eSewa', 'PORTAL'],
  ['Khalti', 'PORTAL'], ['Other online portal', 'PORTAL'], ['Parcel/cargo', 'CARGO'], ['Reserve/hire', 'HIRE'],
];

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);


export function entryView(e: IncomeEntry & { source?: { name: string; kind: string } | null }, now = Date.now()) {
  return {
    id: e.id, vehicleId: e.vehicleId, tripId: e.tripId, date: dayOf(e.date), dateBs: formatBs(dayOf(e.date)),
    sourceId: e.sourceId, source: e.source?.name, sourceKind: e.source?.kind,
    ticketsSold: e.ticketsSold, seatsSold: e.seatsSold, grossPaisa: e.grossPaisa, feesPaisa: e.feesPaisa, netPaisa: e.netPaisa,
    reference: e.reference, note: e.note, hasAttachment: !!e.attachmentKey, importId: e.importId,
    locked: now >= e.lockedAt.getTime(), lockedAt: e.lockedAt, createdAt: e.createdAt,
  };
}

/**
 * Daily income records. Every create, edit and delete is audited with what it was before
 * and after; deletes are soft, so the audit trail always has something to point at.
 */
@Injectable()
export class IncomeService {
  constructor(
    private prisma: PrismaService,
    private access: FinanceAccessService,
    private audit: AuditService,
    private storage: StorageService,
    private mfa: MfaService,
    private fleet: FleetAccessService,
  ) {}

  // ================= settings =================

  async settings(operatorId: string, userId: string) {
    const [{ operator, role }, user] = await Promise.all([
      // Any member but crew may see whether income records are on.
      this.fleet.company(operatorId, userId, 'VIEW'),
      this.prisma.user.findUnique({ where: { id: userId }, select: { totpConfirmedAt: true } }),
    ]);
    return {
      enabled: operator.financeEnabled, enabledAt: operator.financeEnabledAt,
      managersSeeTotals: operator.managersSeeTotals,
      role, canSeeTotals: operator.financeEnabled && (role === 'OWNER' || operator.managersSeeTotals),
      authenticatorReady: !!user?.totpConfirmedAt,
    };
  }

  async updateSettings(operatorId: string, dto: FinanceSettingsDto, userId: string, ip?: string) {
    const { operator } = await this.access.company(operatorId, userId, 'OWN');
    const turningOn = dto.enabled === true && !operator.financeEnabled;
    if (turningOn) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { totpConfirmedAt: true } });
      if (!user?.totpConfirmedAt) {
        throw new ForbiddenException({ code: 'AUTHENTICATOR_REQUIRED', message: 'Set up an authenticator app first. Income records are only for accounts that sign in with one.' });
      }
      if (!dto.code || !(await this.mfa.verify(userId, dto.code))) {
        throw new BadRequestException('Enter the current 6-digit code from your authenticator app.');
      }
    }
    const data: Prisma.OperatorUpdateInput = {};
    if (dto.enabled !== undefined) {
      data.financeEnabled = dto.enabled;
      if (turningOn) data.financeEnabledAt = new Date();
    }
    if (dto.managersSeeTotals !== undefined) data.managersSeeTotals = dto.managersSeeTotals;

    await this.prisma.$transaction(async (tx) => {
      await tx.operator.update({ where: { id: operatorId }, data });
      if (turningOn && !(await tx.incomeSource.count({ where: { operatorId } }))) {
        await tx.incomeSource.createMany({
          data: DEFAULT_SOURCES.map(([name, kind], position) => ({ operatorId, name, kind, position })),
        });
      }
      const changes = [
        dto.enabled !== undefined && dto.enabled !== operator.financeEnabled ? (dto.enabled ? 'turned income records on' : 'turned income records off') : null,
        dto.managersSeeTotals !== undefined && dto.managersSeeTotals !== operator.managersSeeTotals
          ? (dto.managersSeeTotals ? 'shared totals with managers' : 'stopped sharing totals with managers') : null,
      ].filter(Boolean);
      if (changes.length) {
        await this.audit.record({
          actorId: userId, action: 'finance.settings', entityType: 'Operator', entityId: operatorId, operatorId, ip,
          summary: `${operator.name}: ${changes.join('; ')}`,
          before: { financeEnabled: operator.financeEnabled, managersSeeTotals: operator.managersSeeTotals },
          after: { financeEnabled: dto.enabled ?? operator.financeEnabled, managersSeeTotals: dto.managersSeeTotals ?? operator.managersSeeTotals },
        }, tx);
      }
    });
    return this.settings(operatorId, userId);
  }

  // ================= sources =================

  async sources(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId, 'ENTER');
    return this.prisma.incomeSource.findMany({
      where: { operatorId }, orderBy: [{ isActive: 'desc' }, { position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, kind: true, isActive: true, position: true, importMapping: true },
    });
  }

  async addSource(operatorId: string, dto: SourceDto, userId: string, ip?: string) {
    await this.access.company(operatorId, userId, 'OWN');
    const count = await this.prisma.incomeSource.count({ where: { operatorId } });
    if (count >= 50) throw new BadRequestException('A company can have up to 50 income sources.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.incomeSource.create({ data: { operatorId, name: dto.name, kind: dto.kind ?? 'OTHER', position: count } });
        await this.audit.record({
          actorId: userId, action: 'finance.source.create', entityType: 'IncomeSource', entityId: source.id, operatorId, ip,
          summary: `Added the income source “${source.name}”`,
        }, tx);
        return source;
      });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('There is already a source with that name.');
      throw e;
    }
  }

  async updateSource(sourceId: string, dto: UpdateSourceDto, userId: string, ip?: string) {
    const source = await this.prisma.incomeSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new NotFoundException('Income source not found');
    await this.access.company(source.operatorId, userId, 'OWN').catch((e) => {
      throw e instanceof NotFoundException ? new NotFoundException('Income source not found') : e;
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.incomeSource.update({ where: { id: sourceId }, data: dto });
        await this.audit.record({
          actorId: userId, action: 'finance.source.update', entityType: 'IncomeSource', entityId: sourceId,
          operatorId: source.operatorId, ip, summary: `Changed the income source “${updated.name}”`,
          before: { name: source.name, kind: source.kind, isActive: source.isActive }, after: { name: updated.name, kind: updated.kind, isActive: updated.isActive },
        }, tx);
        return updated;
      });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') throw new ConflictException('There is already a source with that name.');
      throw e;
    }
  }

  // ================= the daily sheet =================

  private checkDay(day: string) {
    if (!DAY_RE.test(day) || Number.isNaN(ktmDayStart(day).getTime())) throw new BadRequestException('Dates must be written as YYYY-MM-DD.');
    if (day > ktmToday()) throw new BadRequestException("Income can't be entered for a day that hasn't happened yet.");
    if (day < addDays(ktmToday(), -730)) throw new BadRequestException('Income more than two years old cannot be entered here.');
  }

  /** One bus, one day: every source, what is already entered, and that day's trips to link income to. */
  async sheet(vehicleId: string, day: string | undefined, userId: string) {
    const date = day ?? ktmToday();
    this.checkDay(date);
    const { bus, operator, canSeeTotals } = await this.access.bus(vehicleId, userId, 'ENTER');
    const yesterday = addDays(date, -1);
    const [sources, entries, trips, previous] = await Promise.all([
      this.prisma.incomeSource.findMany({
        where: { operatorId: operator.id }, orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, kind: true, isActive: true },
      }),
      this.prisma.incomeEntry.findMany({
        where: { vehicleId, date: asDate(date), deletedAt: null },
        include: { source: { select: { name: true, kind: true } } }, orderBy: { createdAt: 'asc' },
      }),
      this.prisma.trip.findMany({
        where: { vehicleId, departAt: { gte: ktmDayStart(date), lt: ktmDayStart(addDays(date, 1)) }, status: { not: 'CANCELLED' } },
        select: { id: true, departAt: true, direction: true, driver: { select: { name: true } }, route: { select: { startPlace: true, endPlace: true } } },
        orderBy: { departAt: 'asc' },
      }),
      this.prisma.incomeEntry.findMany({
        where: { vehicleId, date: asDate(yesterday), deletedAt: null }, select: { sourceId: true }, distinct: ['sourceId'],
      }),
    ]);
    return {
      bus: { id: bus.id, plateNo: bus.plateNo, label: bus.label, seatCount: bus.seatCount },
      date, dateBs: formatBs(date), canSeeTotals,
      sources,
      entries: entries.map((e) => entryView(e)),
      trips: trips.map((t) => ({
        id: t.id, departAt: t.departAt, driver: t.driver?.name ?? null,
        run: t.route ? (t.direction === 'REVERSE' ? `${t.route.endPlace} → ${t.route.startPlace}` : `${t.route.startPlace} → ${t.route.endPlace}`) : null,
      })),
      /** "Copy yesterday's sources": the sources this bus had income from the day before. */
      yesterdaySourceIds: previous.map((p) => p.sourceId),
    };
  }

  /**
   * Saves the sheet: new rows are created, changed rows updated, untouched rows left alone.
   * A blank new row (nothing sold, nothing written) is skipped, so an unfilled source on
   * the phone screen is not recorded as a zero.
   */
  async saveSheet(vehicleId: string, day: string, dto: SaveSheetDto, userId: string, ip?: string) {
    this.checkDay(day);
    const { bus, operator } = await this.access.bus(vehicleId, userId, 'ENTER');
    const sourceIds = [...new Set(dto.rows.map((r) => r.sourceId))];
    const tripIds = [...new Set(dto.rows.map((r) => r.tripId).filter(Boolean))] as string[];
    const [sources, trips, existing] = await Promise.all([
      this.prisma.incomeSource.findMany({ where: { id: { in: sourceIds }, operatorId: operator.id }, select: { id: true, name: true, isActive: true } }),
      this.prisma.trip.findMany({ where: { id: { in: tripIds }, vehicleId }, select: { id: true } }),
      this.prisma.incomeEntry.findMany({ where: { id: { in: dto.rows.map((r) => r.id).filter(Boolean) as string[] } } }),
    ]);
    const sourceById = new Map(sources.map((s) => [s.id, s]));
    if (sources.length !== sourceIds.length) throw new BadRequestException('Choose a source from this company’s list.');
    if (trips.length !== tripIds.length) throw new BadRequestException('Link income only to this bus’s trips.');
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const now = new Date();

    const plan: Array<{ row: SheetRowDto; before?: IncomeEntry }> = [];
    for (const row of dto.rows) {
      const fees = row.feesPaisa ?? 0;
      if (fees > row.grossPaisa) throw new BadRequestException(`Fees are larger than the amount for ${sourceById.get(row.sourceId)?.name}.`);
      if (row.id) {
        const before = existingById.get(row.id);
        if (!before || before.vehicleId !== vehicleId || dayOf(before.date) !== day || before.deletedAt) {
          throw new NotFoundException('Income entry not found');
        }
        if (now >= before.lockedAt) throw new ConflictException(`The ${sourceById.get(row.sourceId)?.name} entry is more than 7 days old and can no longer be changed.`);
        plan.push({ row, before });
      } else {
        const blank = !row.grossPaisa && !row.ticketsSold && !row.reference && !row.note;
        if (blank) continue;
        if (!sourceById.get(row.sourceId)?.isActive) throw new BadRequestException(`${sourceById.get(row.sourceId)?.name} is no longer in use.`);
        plan.push({ row });
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const { row, before } of plan) {
          const fees = row.feesPaisa ?? 0;
          const data = {
            sourceId: row.sourceId, tripId: row.tripId ?? null, ticketsSold: row.ticketsSold, seatsSold: row.seatsSold ?? null,
            grossPaisa: row.grossPaisa, feesPaisa: fees, netPaisa: row.grossPaisa - fees,
            reference: row.reference ?? null, note: row.note ?? null,
          };
          const source = sourceById.get(row.sourceId)!.name;
          if (before) {
            const changed = (Object.keys(data) as Array<keyof typeof data>).filter((k) => before[k] !== data[k]);
            if (!changed.length) continue;
            await tx.incomeEntry.update({ where: { id: before.id }, data: { ...data, updatedById: userId } });
            await this.audit.record({
              actorId: userId, action: 'income.update', entityType: 'IncomeEntry', entityId: before.id, operatorId: operator.id, ip,
              summary: `${bus.plateNo}, ${day}, ${source}: changed ${changed.join(', ')}`,
              before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, data[k]])),
            }, tx);
          } else {
            const created = await tx.incomeEntry.create({
              data: {
                ...data, operatorId: operator.id, vehicleId, date: asDate(day), createdById: userId,
                lockedAt: new Date(now.getTime() + LOCK_AFTER_MS),
              },
            });
            await this.audit.record({
              actorId: userId, action: 'income.create', entityType: 'IncomeEntry', entityId: created.id, operatorId: operator.id, ip,
              summary: `${bus.plateNo}, ${day}, ${source}: ${formatPaisa(created.netPaisa)} net, ${created.ticketsSold} tickets`,
              after: data,
            }, tx);
          }
        }
      });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError).code === 'P2002') {
        throw new ConflictException('One of these settlement references is already entered for that source. Each settlement can be entered once.');
      }
      throw e;
    }
    return this.sheet(vehicleId, day, userId);
  }

  async remove(entryId: string, userId: string, ip?: string) {
    const { entry, operator } = await this.access.entry(entryId, userId, 'ENTER');
    if (Date.now() >= entry.lockedAt.getTime()) throw new ConflictException('This entry is more than 7 days old and can no longer be deleted.');
    await this.prisma.$transaction(async (tx) => {
      await tx.incomeEntry.update({ where: { id: entryId }, data: { deletedAt: new Date(), deletedById: userId } });
      await this.audit.record({
        actorId: userId, action: 'income.delete', entityType: 'IncomeEntry', entityId: entryId, operatorId: operator.id, ip,
        summary: `Deleted ${formatPaisa(entry.netPaisa)} of income for ${dayOf(entry.date)}`,
        before: { grossPaisa: entry.grossPaisa, feesPaisa: entry.feesPaisa, reference: entry.reference, ticketsSold: entry.ticketsSold },
      }, tx);
    });
    return { deleted: true };
  }

  // ================= statement photos =================

  async attach(entryId: string, file: { buffer: Buffer; size: number } | undefined, userId: string, ip?: string) {
    const { entry, operator } = await this.access.entry(entryId, userId, 'ENTER');
    if (Date.now() >= entry.lockedAt.getTime()) throw new ConflictException('This entry is more than 7 days old and can no longer be changed.');
    if (!file?.buffer?.length) throw new BadRequestException('Choose a photo of the statement.');
    // Drawn again from its pixels: the phone's location and other metadata are not kept.
    const clean = await reencode(file.buffer).catch((e) => {
      if (e instanceof NotAnImageError) throw new BadRequestException('That file is not a real photo. Take the picture again, or save it as JPG or PNG.');
      throw e;
    });
    const key = `income/${operator.id}/${randomUUID()}.webp`;
    await this.storage.put(key, clean.buffer);
    await this.prisma.$transaction(async (tx) => {
      await tx.incomeEntry.update({ where: { id: entryId }, data: { attachmentKey: key, updatedById: userId } });
      await this.audit.record({
        actorId: userId, action: 'income.attach', entityType: 'IncomeEntry', entityId: entryId, operatorId: operator.id, ip,
        summary: `Attached a statement photo to the income for ${dayOf(entry.date)}`,
      }, tx);
    });
    if (entry.attachmentKey) await this.storage.remove(entry.attachmentKey);
    return { attached: true };
  }

  /** A link to the photo that works for five minutes, for someone allowed to see the entry. */
  async attachment(entryId: string, userId: string) {
    const { entry } = await this.access.entry(entryId, userId, 'ENTER');
    if (!entry.attachmentKey) throw new NotFoundException('No statement photo on this entry');
    return { url: this.storage.signedUrl(entry.attachmentKey, 300), expiresInSeconds: 300 };
  }
}
