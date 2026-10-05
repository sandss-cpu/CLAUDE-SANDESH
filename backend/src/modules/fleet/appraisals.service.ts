import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AppraisalStatus, DriverAppraisal, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatBs } from '../../common/utils/bs-date';
import { AppraisalListQueryDto, CreateAppraisalDto, UpdateAppraisalDto } from './dto/fleet.dto';
import { FleetAccessService } from './fleet-access.service';
import { appraisalPdf } from './appraisal-pdf';
import { CRITERIA, Criterion } from './scorecard';
import { ScorecardService } from './scorecard.service';

/** Criterion → column. */
export const SCORE_FIELDS: Record<Criterion, keyof DriverAppraisal & `${string}Score`> = {
  driving: 'drivingScore',
  punctuality: 'punctualityScore',
  conduct: 'conductScore',
  safety: 'safetyScore',
  vehicleCare: 'vehicleCareScore',
  attendance: 'attendanceScore',
};

const INCLUDE = {
  driver: { select: { id: true, name: true, role: true } },
  appraiser: { select: { name: true } },
  operator: { select: { name: true } },
} satisfies Prisma.DriverAppraisalInclude;
type Row = Prisma.DriverAppraisalGetPayload<{ include: typeof INCLUDE }>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const blank = (s: string | null | undefined) => (s === undefined ? undefined : s?.trim() ? s.trim() : null);

export function appraisalView(a: Row) {
  const scores = Object.fromEntries(CRITERIA.map((c) => [c, a[SCORE_FIELDS[c]] as number | null])) as Record<Criterion, number | null>;
  const given = Object.values(scores).filter((v): v is number => v != null);
  return {
    id: a.id, status: a.status, outcome: a.outcome,
    driver: a.driver, company: a.operator.name, appraiser: a.appraiser?.name ?? null,
    period: {
      from: day(a.periodStart), to: day(a.periodEnd),
      fromBs: formatBs(day(a.periodStart)), toBs: formatBs(day(a.periodEnd)),
    },
    scores,
    average: given.length ? Math.round((given.reduce((x, y) => x + y, 0) / given.length) * 10) / 10 : null,
    missing: CRITERIA.filter((c) => scores[c] == null),
    suggested: a.suggested,
    comments: a.comments, strengths: a.strengths, goals: a.goals,
    finalisedAt: a.finalisedAt, acknowledgedAt: a.acknowledgedAt,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}
export type AppraisalView = ReturnType<typeof appraisalView>;

/**
 * Appraisals of crew members. Owners and managers write them; a draft starts from what
 * the scorecard suggests, and a final one can only be acknowledged, never changed.
 * Every change is audited.
 */
@Injectable()
export class AppraisalsService {
  constructor(
    private prisma: PrismaService,
    private access: FleetAccessService,
    private scores: ScorecardService,
    private audit: AuditService,
  ) {}

  private async forMember(id: string, userId: string, level: 'VIEW' | 'MANAGE') {
    const appraisal = await this.prisma.driverAppraisal.findUnique({ where: { id }, include: INCLUDE });
    if (!appraisal) throw new NotFoundException('Appraisal not found');
    // Someone outside the company gets the same answer as for an id that does not exist.
    await this.access.company(appraisal.operatorId, userId, level).catch((e) => {
      throw e instanceof NotFoundException ? new NotFoundException('Appraisal not found') : e;
    });
    return appraisal;
  }

  async forDriver(driverId: string, userId: string) {
    const driver = await this.scores.driverFor(driverId, userId);
    const rows = await this.prisma.driverAppraisal.findMany({
      where: { driverId: driver.id }, include: INCLUDE, orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map(appraisalView);
  }

  async forCompany(operatorId: string, q: AppraisalListQueryDto, userId: string) {
    await this.access.company(operatorId, userId);
    const rows = await this.prisma.driverAppraisal.findMany({
      where: { operatorId, ...(q.status ? { status: q.status } : {}), ...(q.driverId ? { driverId: q.driverId } : {}) },
      include: INCLUDE, orderBy: [{ updatedAt: 'desc' }], take: 200,
    });
    return rows.map(appraisalView);
  }

  async one(id: string, userId: string) {
    return appraisalView(await this.forMember(id, userId, 'VIEW'));
  }

  async create(driverId: string, dto: CreateAppraisalDto, userId: string, ip?: string) {
    const driver = await this.scores.driverFor(driverId, userId, 'MANAGE');
    const period = this.scores.period(dto.periodStart, dto.periodEnd);
    const card = await this.scores.compute(driver, period);
    const s = card.suggestions;
    // What the data said when the draft was made, kept beside what the owner chooses.
    const suggested = {
      criteria: s,
      summary: {
        reviews: card.passengers.reviews,
        enoughReviews: card.passengers.enough,
        overall: card.passengers.scores.overall.adjusted,
        trips: card.trips.trips, km: card.trips.km,
        kmPerLitre: card.fuel.kmPerLitre, sameBusesKmPerLitre: card.fuel.sameBusesKmPerLitre,
        accidents: card.incidents.accidents, breakdowns: card.incidents.breakdowns,
        praise: card.comments.praise.slice(0, 3), complaints: card.comments.complaints.slice(0, 3),
      },
    };
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driverAppraisal.create({
        data: {
          operatorId: driver.operatorId, driverId: driver.id, appraiserId: userId,
          periodStart: asDate(period.fromDay), periodEnd: asDate(period.toDay),
          ...Object.fromEntries(CRITERIA.map((c) => [SCORE_FIELDS[c], s[c].value])),
          suggested: suggested as unknown as Prisma.InputJsonValue,
        },
        include: INCLUDE,
      });
      await this.audit.record({
        actorId: userId, action: 'appraisal.create', entityType: 'DriverAppraisal', entityId: row.id,
        operatorId: driver.operatorId, ip,
        summary: `Started an appraisal of ${driver.name} for ${period.fromDay} to ${period.toDay}`,
      }, tx);
      return row;
    });
    return appraisalView(created);
  }

  async update(id: string, dto: UpdateAppraisalDto, userId: string, ip?: string) {
    const before = await this.forMember(id, userId, 'MANAGE');
    if (before.status !== AppraisalStatus.DRAFT) {
      throw new ConflictException('A final appraisal cannot be changed. Start a new one for a new period.');
    }
    const data: Prisma.DriverAppraisalUpdateInput = {};
    for (const c of CRITERIA) {
      const v = dto[SCORE_FIELDS[c] as keyof UpdateAppraisalDto];
      if (v !== undefined) (data as Record<string, unknown>)[SCORE_FIELDS[c]] = v;
    }
    if (dto.comments !== undefined) data.comments = blank(dto.comments);
    if (dto.strengths !== undefined) data.strengths = blank(dto.strengths);
    if (dto.goals !== undefined) data.goals = blank(dto.goals);
    if (dto.outcome !== undefined) data.outcome = dto.outcome;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driverAppraisal.update({ where: { id }, data, include: INCLUDE });
      const changed = Object.keys(data);
      if (changed.length) {
        await this.audit.record({
          actorId: userId, action: 'appraisal.update', entityType: 'DriverAppraisal', entityId: id,
          operatorId: row.operatorId, ip,
          summary: `Edited the appraisal of ${row.driver.name}: ${changed.join(', ')}`,
          before: pick(before, changed), after: pick(row, changed),
        }, tx);
      }
      return row;
    });
    return appraisalView(updated);
  }

  async finalise(id: string, userId: string, ip?: string) {
    const a = await this.forMember(id, userId, 'MANAGE');
    if (a.status === AppraisalStatus.FINAL) throw new ConflictException('This appraisal is already final.');
    const missing = CRITERIA.filter((c) => a[SCORE_FIELDS[c]] == null);
    if (missing.length) {
      throw new BadRequestException(`Give a score for every criterion before finalising (missing: ${missing.map(label).join(', ')}).`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driverAppraisal.update({
        where: { id }, data: { status: AppraisalStatus.FINAL, finalisedAt: new Date() }, include: INCLUDE,
      });
      await this.audit.record({
        actorId: userId, action: 'appraisal.finalise', entityType: 'DriverAppraisal', entityId: id,
        operatorId: row.operatorId, ip,
        summary: `Finalised the appraisal of ${row.driver.name} (outcome: ${row.outcome.toLowerCase()})`,
        after: appraisalView(row).scores,
      }, tx);
      return row;
    });
    return appraisalView(updated);
  }

  /** Recorded when the owner or manager has gone through the appraisal with the driver. */
  async acknowledge(id: string, userId: string, ip?: string) {
    const a = await this.forMember(id, userId, 'MANAGE');
    if (a.status !== AppraisalStatus.FINAL) throw new ConflictException('Finalise the appraisal before recording that it was discussed.');
    if (a.acknowledgedAt) throw new ConflictException('This appraisal was already discussed with the driver.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.driverAppraisal.update({ where: { id }, data: { acknowledgedAt: new Date() }, include: INCLUDE });
      await this.audit.record({
        actorId: userId, action: 'appraisal.acknowledge', entityType: 'DriverAppraisal', entityId: id,
        operatorId: row.operatorId, ip, summary: `Recorded that the appraisal was discussed with ${row.driver.name}`,
      }, tx);
      return row;
    });
    return appraisalView(updated);
  }

  async remove(id: string, userId: string, ip?: string) {
    const a = await this.forMember(id, userId, 'MANAGE');
    if (a.status !== AppraisalStatus.DRAFT) throw new ConflictException('A final appraisal is part of the record and cannot be deleted.');
    await this.prisma.$transaction(async (tx) => {
      await tx.driverAppraisal.delete({ where: { id } });
      await this.audit.record({
        actorId: userId, action: 'appraisal.delete', entityType: 'DriverAppraisal', entityId: id,
        operatorId: a.operatorId, ip, summary: `Deleted a draft appraisal of ${a.driver.name}`,
      }, tx);
    });
    return { deleted: true };
  }

  async pdf(id: string, userId: string) {
    const view = appraisalView(await this.forMember(id, userId, 'VIEW'));
    const body = await appraisalPdf(view);
    const name = view.driver.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'driver';
    return { body, contentType: 'application/pdf', filename: `batoma-appraisal-${name}-${view.period.to}.pdf` };
  }
}

const LABELS: Record<Criterion, string> = {
  driving: 'passenger driving score', punctuality: 'punctuality', conduct: 'conduct',
  safety: 'safety record', vehicleCare: 'vehicle care', attendance: 'attendance',
};
const label = (c: Criterion) => LABELS[c];

function pick(row: object, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));
}
