import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { formatBs, kathmanduDay } from '../../common/utils/bs-date';
import { kathmanduPeriod, ktmToday, Period } from '../../common/utils/ktm-period';
import { ReportQueryDto } from './dto/finance.dto';
import { FinanceAccessService } from './finance-access.service';
import { incomePdf } from './income-pdf';
import { csvLine } from './import/csv';
import { paisaToDecimal } from './money';
import { dashboard, incomeReport, reconciliation, ReportBus, ReportCost, ReportEntry, ReportTrip } from './reports';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * Totals: reports, the dashboard, reconciliation and exports. Owners always; managers only
 * when the owner shares totals with them (FinanceAccessService, level TOTALS).
 */
@Injectable()
export class IncomeReportsService {
  constructor(private prisma: PrismaService, private access: FinanceAccessService) {}

  private periodView(p: Period) {
    return { from: p.fromDay, to: p.toDay, fromBs: formatBs(p.fromDay), toBs: formatBs(p.toDay) };
  }

  private async entries(operatorId: string, fromDay: string, toDay: string): Promise<ReportEntry[]> {
    const rows = await this.prisma.incomeEntry.findMany({
      where: { operatorId, deletedAt: null, date: { gte: asDate(fromDay), lte: asDate(toDay) } },
      select: { vehicleId: true, tripId: true, date: true, sourceId: true, grossPaisa: true, feesPaisa: true, netPaisa: true, ticketsSold: true, reference: true },
    });
    return rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
  }

  private async buses(operatorId: string): Promise<ReportBus[]> {
    const rows = await this.prisma.vehicle.findMany({
      where: { operatorId },
      select: { id: true, plateNo: true, label: true, seatCount: true, routeId: true, route: { select: { name: true } } },
    });
    return rows.map((b) => ({ id: b.id, plateNo: b.plateNo, label: b.label, seatCount: b.seatCount, routeId: b.routeId, routeName: b.route?.name ?? null }));
  }

  /** Loads the period and runs the report: by bus, route or driver, by day, week or month. */
  private async build(operatorId: string, q: ReportQueryDto) {
    const period = kathmanduPeriod(q.from, q.to, { defaultDays: 30, maxDays: 732 });
    const range = { gte: period.from, lt: period.to };
    const [entries, buses, trips, fuel, maintenance, incidents] = await Promise.all([
      this.entries(operatorId, period.fromDay, period.toDay),
      this.buses(operatorId),
      this.prisma.trip.findMany({
        where: { operatorId, departAt: range },
        select: {
          id: true, vehicleId: true, routeId: true, driverId: true, status: true, departAt: true, startOdometerKm: true, endOdometerKm: true,
          route: { select: { name: true } }, driver: { select: { name: true } },
        },
      }),
      this.prisma.fuelLog.findMany({ where: { vehicle: { operatorId }, filledAt: range }, select: { vehicleId: true, filledAt: true, costNpr: true } }),
      this.prisma.maintenanceRecord.findMany({ where: { vehicle: { operatorId }, servicedAt: range, costNpr: { not: null } }, select: { vehicleId: true, servicedAt: true, costNpr: true } }),
      this.prisma.busIncident.findMany({ where: { vehicle: { operatorId }, occurredAt: range, repairCostNpr: { not: null } }, select: { vehicleId: true, occurredAt: true, repairCostNpr: true } }),
    ]);
    // Trips that ran before the period but whose income was entered within it still need their driver.
    const linked = [...new Set(entries.map((e) => e.tripId).filter((id): id is string => !!id && !trips.some((t) => t.id === id)))];
    const extra = linked.length ? await this.prisma.trip.findMany({
      where: { id: { in: linked }, operatorId },
      select: { id: true, vehicleId: true, routeId: true, driverId: true, status: true, departAt: true, startOdometerKm: true, endOdometerKm: true, route: { select: { name: true } }, driver: { select: { name: true } } },
    }) : [];
    const tripView = (t: typeof trips[number], countIt: boolean): ReportTrip => ({
      id: t.id, vehicleId: t.vehicleId, routeId: t.routeId, routeName: t.route?.name ?? null,
      driverId: t.driverId, driverName: t.driver?.name ?? null, day: kathmanduDay(t.departAt),
      // A trip outside the period only places income; it does not count as a trip run in it.
      status: countIt ? t.status : 'CANCELLED',
      km: t.startOdometerKm != null && t.endOdometerKm != null ? t.endOdometerKm - t.startOdometerKm : null,
    });
    const costs: ReportCost[] = [
      ...fuel.map((f) => ({ vehicleId: f.vehicleId, day: kathmanduDay(f.filledAt), npr: f.costNpr, kind: 'fuel' as const })),
      ...maintenance.map((m) => ({ vehicleId: m.vehicleId, day: kathmanduDay(m.servicedAt), npr: m.costNpr ?? 0, kind: 'maintenance' as const })),
      ...incidents.map((i) => ({ vehicleId: i.vehicleId, day: kathmanduDay(i.occurredAt), npr: i.repairCostNpr ?? 0, kind: 'repairs' as const })),
    ];
    const groupBy = q.groupBy ?? 'bus';
    const bucket = q.bucket ?? 'day';
    const report = incomeReport({
      groupBy, bucket, entries, buses, costs,
      trips: [...trips.map((t) => tripView(t, true)), ...extra.map((t) => tripView(t, false))],
    });
    return { period, groupBy, bucket, report };
  }

  async report(operatorId: string, q: ReportQueryDto, userId: string) {
    await this.access.company(operatorId, userId, 'TOTALS');
    const { period, groupBy, bucket, report } = await this.build(operatorId, q);
    return { period: this.periodView(period), groupBy, bucket, ...report };
  }

  async dashboard(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId, 'TOTALS');
    const today = ktmToday();
    // Twelve months of bars: from the first of the month eleven months back.
    const [y, m] = today.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10);
    const [entries, buses] = await Promise.all([this.entries(operatorId, from, today), this.buses(operatorId)]);
    // dashboard() returns today itself.
    return { todayBs: formatBs(today), ...dashboard(entries, buses, today) };
  }

  async reconciliation(operatorId: string, q: ReportQueryDto, userId: string) {
    await this.access.company(operatorId, userId, 'TOTALS');
    const period = kathmanduPeriod(q.from, q.to, { defaultDays: 30, maxDays: 366 });
    const [entries, sources] = await Promise.all([
      this.entries(operatorId, period.fromDay, period.toDay),
      this.prisma.incomeSource.findMany({ where: { operatorId }, select: { id: true, name: true, kind: true }, orderBy: { position: 'asc' } }),
    ]);
    return { period: this.periodView(period), ...reconciliation(entries, sources) };
  }

  async csv(operatorId: string, q: ReportQueryDto, userId: string) {
    const { operator } = await this.access.company(operatorId, userId, 'TOTALS');
    const { period, groupBy, report } = await this.build(operatorId, q);
    const npr = (p: number | null | undefined) => (p == null ? '' : paisaToDecimal(p));
    const pct = (o: number | null) => (o == null ? '' : (o * 100).toFixed(1));
    const head = { bus: 'Bus', route: 'Route', driver: 'Driver' }[groupBy];
    const lines = [
      csvLine([`${operator.name}: income ${period.fromDay} to ${period.toDay} (${formatBs(period.fromDay)} to ${formatBs(period.toDay)} BS)`]),
      csvLine([head, 'Detail', 'Tickets', 'Trips', 'Occupancy %', 'Km', 'Gross NPR', 'Fees NPR', 'Net NPR', 'Fuel NPR', 'Maintenance NPR', 'Repairs NPR', 'Operating profit NPR', 'Net per km NPR']),
      ...report.rows.map((r) => csvLine([
        r.label, r.detail ?? '', r.tickets, r.trips, pct(r.occupancy), r.km, npr(r.grossPaisa), npr(r.feesPaisa), npr(r.netPaisa),
        npr(r.costs?.fuelPaisa), npr(r.costs?.maintenancePaisa), npr(r.costs?.repairsPaisa), npr(r.profitPaisa), npr(r.revenuePerKmPaisa),
      ])),
      csvLine(['Total', '', report.totals.tickets, report.totals.trips, pct(report.totals.occupancy), report.totals.km,
        npr(report.totals.grossPaisa), npr(report.totals.feesPaisa), npr(report.totals.netPaisa), '', '', '',
        npr(report.totals.profitPaisa), npr(report.totals.revenuePerKmPaisa)]),
      '',
      csvLine([report.note]),
    ];
    return {
      // A byte-order mark, so Excel opens the Nepali text and the rupee figures as UTF-8.
      body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8'),
      contentType: 'text/csv; charset=utf-8',
      filename: `batoma-income-${groupBy}-${period.fromDay}-to-${period.toDay}.csv`,
    };
  }

  async pdf(operatorId: string, q: ReportQueryDto, userId: string) {
    const { operator } = await this.access.company(operatorId, userId, 'TOTALS');
    const { period, groupBy, report } = await this.build(operatorId, q);
    const body = await incomePdf({ company: operator.name, period: this.periodView(period), groupBy, report });
    return { body, contentType: 'application/pdf', filename: `batoma-income-${groupBy}-${period.fromDay}-to-${period.toDay}.pdf` };
  }
}

