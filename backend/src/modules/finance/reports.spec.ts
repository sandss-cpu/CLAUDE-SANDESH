import { bucketOf, dashboard, incomeReport, reconciliation, ReportBus, ReportCost, ReportEntry, ReportTrip } from './reports';

/**
 * The profit fixture the brief asks for. Every figure was worked on paper first; the
 * working is beside each expectation.
 */
const buses: ReportBus[] = [
  { id: 'X', plateNo: 'BA 1 KHA 1', label: 'Deluxe', seatCount: 30, routeId: 'R1', routeName: 'Kathmandu – Pokhara' },
  { id: 'Y', plateNo: 'BA 2 KHA 2', label: 'Hiace', seatCount: 14, routeId: 'R2', routeName: 'Kathmandu – Chitwan' },
];
const trips: ReportTrip[] = [
  { id: 'T1', vehicleId: 'X', routeId: 'R1', routeName: 'Kathmandu – Pokhara', driverId: 'D1', driverName: 'Ram', day: '2026-09-01', status: 'COMPLETED', km: 200 },
  { id: 'T2', vehicleId: 'X', routeId: 'R1', routeName: 'Kathmandu – Pokhara', driverId: 'D2', driverName: 'Hari', day: '2026-09-02', status: 'COMPLETED', km: 200 },
  { id: 'T3', vehicleId: 'Y', routeId: 'R2', routeName: 'Kathmandu – Chitwan', driverId: 'D1', driverName: 'Ram', day: '2026-09-02', status: 'COMPLETED', km: 150 },
  { id: 'T4', vehicleId: 'X', routeId: 'R1', routeName: 'Kathmandu – Pokhara', driverId: 'D2', driverName: 'Hari', day: '2026-09-03', status: 'CANCELLED', km: null },
];
const NPR = 100;
const entry = (e: Partial<ReportEntry> & Pick<ReportEntry, 'vehicleId' | 'date' | 'sourceId' | 'grossPaisa'>): ReportEntry =>
  ({ tripId: null, feesPaisa: 0, netPaisa: e.grossPaisa - (e.feesPaisa ?? 0), ticketsSold: 0, reference: null, ...e });
const entries: ReportEntry[] = [
  entry({ vehicleId: 'X', tripId: 'T1', date: '2026-09-01', sourceId: 'cash', grossPaisa: 30_000 * NPR, ticketsSold: 20 }),
  entry({ vehicleId: 'X', tripId: 'T1', date: '2026-09-01', sourceId: 'bussewa', grossPaisa: 15_000 * NPR, feesPaisa: 750 * NPR, ticketsSold: 10, reference: 'BS-1' }),
  entry({ vehicleId: 'X', tripId: 'T2', date: '2026-09-02', sourceId: 'cash', grossPaisa: 18_000 * NPR, ticketsSold: 15 }),
  entry({ vehicleId: 'Y', date: '2026-09-02', sourceId: 'esewa', grossPaisa: 9_000 * NPR, feesPaisa: 270 * NPR, ticketsSold: 9 }),
];
// Bus X: fuel 20,000 + maintenance 5,000 + repairs 1,000 = 26,000 NPR. Bus Y: fuel 4,000 NPR.
const costs: ReportCost[] = [
  { vehicleId: 'X', day: '2026-09-01', npr: 20_000, kind: 'fuel' },
  { vehicleId: 'X', day: '2026-09-02', npr: 5_000, kind: 'maintenance' },
  { vehicleId: 'X', day: '2026-09-02', npr: 1_000, kind: 'repairs' },
  { vehicleId: 'Y', day: '2026-09-02', npr: 4_000, kind: 'fuel' },
];

describe('income report', () => {
  it('works out profit, occupancy and revenue per km per bus', () => {
    const r = incomeReport({ groupBy: 'bus', bucket: 'month', entries, buses, trips, costs });
    // X net: 30,000 + (15,000 − 750) + 18,000 = 62,250 NPR. Profit 62,250 − 26,000 = 36,250.
    // Occupancy 45 tickets ÷ (30 seats × 2 trips; the cancelled one does not count) = 0.75.
    // Revenue per km 6,225,000 paisa ÷ 400 km = 15,562.5 → 15,563 paisa.
    expect(r.rows[0]).toMatchObject({
      key: 'X', grossPaisa: 6_300_000, feesPaisa: 75_000, netPaisa: 6_225_000, tickets: 45, trips: 2, km: 400,
      occupancy: 0.75, revenuePerKmPaisa: 15_563,
      costs: { fuelPaisa: 2_000_000, maintenancePaisa: 500_000, repairsPaisa: 100_000, totalPaisa: 2_600_000 },
      profitPaisa: 3_625_000,
      series: [{ bucket: '2026-09', netPaisa: 6_225_000, tickets: 45 }],
    });
    // Y net 9,000 − 270 = 8,730. Profit 8,730 − 4,000 = 4,730. Occupancy 9 ÷ 14 = 0.643. Per km 873,000 ÷ 150 = 5,820.
    expect(r.rows[1]).toMatchObject({ key: 'Y', netPaisa: 873_000, occupancy: 0.643, revenuePerKmPaisa: 5_820, profitPaisa: 473_000 });
    // Totals: net 70,980 NPR; costs 30,000; profit 40,980. Occupancy 54 ÷ 74 = 0.730. Per km 7,098,000 ÷ 550 = 12,905.
    expect(r.totals).toEqual({
      grossPaisa: 7_200_000, feesPaisa: 102_000, netPaisa: 7_098_000, tickets: 54, trips: 3, km: 550,
      occupancy: 0.73, revenuePerKmPaisa: 12_905, costPaisa: 3_000_000, profitPaisa: 4_098_000,
    });
    expect(r.note).toContain('leaves out wages');
  });

  it('places income by driver through the trip it was entered against', () => {
    const r = incomeReport({ groupBy: 'driver', bucket: 'day', entries, buses, trips, costs });
    const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    // Ram: T1's income 44,250 NPR; trips T1 and T3 offer 30 + 14 = 44 seats: 30 ÷ 44 = 0.682. 350 km: 12,643 paisa per km.
    expect(by.D1).toMatchObject({ netPaisa: 4_425_000, tickets: 30, trips: 2, occupancy: 0.682, km: 350, revenuePerKmPaisa: 12_643, profitPaisa: null, costs: null });
    expect(by.D2).toMatchObject({ netPaisa: 1_800_000, tickets: 15, trips: 1, occupancy: 0.5, revenuePerKmPaisa: 9_000 });
    // Bus Y's eSewa income was not entered against a trip.
    expect(by.unlinked).toMatchObject({ label: 'Not linked to a trip', netPaisa: 873_000, trips: 0, occupancy: null, revenuePerKmPaisa: null });
    expect(r.totals.profitPaisa).toBeNull();
  });

  it('groups by route, following the trip or else the bus', () => {
    const r = incomeReport({ groupBy: 'route', bucket: 'week', entries, buses, trips, costs });
    expect(r.rows.map((x) => [x.key, x.netPaisa, x.profitPaisa])).toEqual([['R1', 6_225_000, 3_625_000], ['R2', 873_000, 473_000]]);
    // 1 September 2026 is a Tuesday; its week starts on Sunday 30 August.
    expect(r.rows[0].series[0].bucket).toBe('2026-08-30');
  });

  it('buckets days into Sunday weeks and months', () => {
    expect(bucketOf('2026-10-04', 'week')).toBe('2026-10-04'); // a Sunday
    expect(bucketOf('2026-10-10', 'week')).toBe('2026-10-04'); // the Saturday after
    expect(bucketOf('2026-10-10', 'month')).toBe('2026-10');
  });
});

describe('dashboard', () => {
  it('compares this month so far with the same days of last month', () => {
    const list = [
      entry({ vehicleId: 'X', date: '2026-10-04', sourceId: 'cash', grossPaisa: 10_000 * NPR, ticketsSold: 8 }),
      entry({ vehicleId: 'Y', date: '2026-10-02', sourceId: 'cash', grossPaisa: 2_000 * NPR }),
      entry({ vehicleId: 'X', date: '2026-09-03', sourceId: 'cash', grossPaisa: 8_000 * NPR }),
      entry({ vehicleId: 'X', date: '2026-09-20', sourceId: 'cash', grossPaisa: 50_000 * NPR }),
    ];
    const d = dashboard(list, buses, '2026-10-04');
    expect(d.today).toEqual({ netPaisa: 1_000_000, tickets: 8 });
    expect(d.thisMonth.netPaisa).toBe(1_200_000);
    // Same days last month: 1–4 September = 8,000 NPR. 12,000 against 8,000 is 50% up.
    expect(d.lastMonth).toEqual({ month: '2026-09', netPaisa: 5_800_000, sameDaysNetPaisa: 800_000 });
    expect(d.change).toBe(0.5);
    expect(d.bestBus?.id).toBe('X');
    expect(d.worstBus?.id).toBe('Y');
    expect(d.monthly).toHaveLength(12);
    expect(d.monthly[11]).toEqual({ month: '2026-10', netPaisa: 1_200_000 });
    expect(d.daily).toHaveLength(30);
    expect(d.daily[29]).toEqual({ day: '2026-10-04', netPaisa: 1_000_000 });
  });
});

describe('reconciliation', () => {
  it('sets settlement-referenced income against unreferenced cash, and flags portal income with no reference', () => {
    const r = reconciliation(entries, [
      { id: 'cash', name: 'Counter cash', kind: 'CASH' },
      { id: 'bussewa', name: 'Bussewa', kind: 'PORTAL' },
      { id: 'esewa', name: 'eSewa', kind: 'PORTAL' },
      { id: 'khalti', name: 'Khalti', kind: 'PORTAL' },
    ]);
    expect(r.perSource).toEqual([
      { sourceId: 'cash', name: 'Counter cash', kind: 'CASH', referenced: { count: 0, netPaisa: 0 }, unreferenced: { count: 2, netPaisa: 4_800_000 }, missingReference: 0 },
      { sourceId: 'bussewa', name: 'Bussewa', kind: 'PORTAL', referenced: { count: 1, netPaisa: 1_425_000 }, unreferenced: { count: 0, netPaisa: 0 }, missingReference: 0 },
      { sourceId: 'esewa', name: 'eSewa', kind: 'PORTAL', referenced: { count: 0, netPaisa: 0 }, unreferenced: { count: 1, netPaisa: 873_000 }, missingReference: 1 },
    ]);
    expect(r.perDay).toEqual([
      { day: '2026-09-01', settledPaisa: 1_425_000, unreferencedCashPaisa: 3_000_000, portalPaisa: 1_425_000, portalMissingReference: 0 },
      { day: '2026-09-02', settledPaisa: 0, unreferencedCashPaisa: 1_800_000, portalPaisa: 873_000, portalMissingReference: 1 },
    ]);
  });
});
