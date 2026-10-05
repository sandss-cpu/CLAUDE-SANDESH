/**
 * Income reports: pure functions over rows the service has loaded, so the profit figure
 * can be checked against a hand-worked fixture (reports.spec.ts).
 *
 * Revenue is net income: what reached the company after portal fees. Fuel, maintenance
 * and repair costs are recorded in whole rupees elsewhere in the portal and are turned
 * into paisa here, at the report layer, rather than migrating working modules.
 */

export const PROFIT_NOTE =
  'Operating profit is income after portal fees, less the fuel, maintenance and breakdown repair costs recorded in Batoma for the same days. ' +
  'It leaves out wages, allowances, loan instalments, route permits, tax, insurance and anything else not recorded here.';

export type GroupBy = 'bus' | 'route' | 'driver';
export type Bucket = 'day' | 'week' | 'month';

export interface ReportEntry {
  vehicleId: string; tripId: string | null; date: string; sourceId: string;
  grossPaisa: number; feesPaisa: number; netPaisa: number; ticketsSold: number; reference: string | null;
}
export interface ReportBus { id: string; plateNo: string; label: string | null; seatCount: number | null; routeId: string | null; routeName: string | null }
export interface ReportTrip {
  id: string; vehicleId: string; routeId: string | null; routeName: string | null;
  driverId: string | null; driverName: string | null; day: string; status: string; km: number | null;
}
/** A cost in whole rupees on a Kathmandu day, as the fuel, maintenance and incident records keep it. */
export interface ReportCost { vehicleId: string; day: string; npr: number; kind: 'fuel' | 'maintenance' | 'repairs' }

/** Sunday-first weeks, as Nepal's working week runs (Saturday is the day off). */
export function bucketOf(day: string, bucket: Bucket): string {
  if (bucket === 'day') return day;
  if (bucket === 'month') return day.slice(0, 7);
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - t.getUTCDay());
  return t.toISOString().slice(0, 10);
}

interface Acc {
  key: string; label: string; detail: string | null;
  grossPaisa: number; feesPaisa: number; netPaisa: number; tickets: number;
  trips: number; seatsOffered: number; km: number; tripsWithKm: number;
  costs: { fuel: number; maintenance: number; repairs: number };
  series: Map<string, { netPaisa: number; tickets: number }>;
}

const blank = (key: string, label: string, detail: string | null = null): Acc => ({
  key, label, detail, grossPaisa: 0, feesPaisa: 0, netPaisa: 0, tickets: 0, trips: 0, seatsOffered: 0, km: 0, tripsWithKm: 0,
  costs: { fuel: 0, maintenance: 0, repairs: 0 }, series: new Map(),
});

export const UNLINKED = 'unlinked';

/**
 * Revenue, tickets, occupancy, revenue per km and operating profit, by bus, route or
 * driver, with a series by day, week or month.
 *
 * - Occupancy is tickets ÷ (seats × trips logged), so it needs the duty log and the bus's
 *   seat count; without them it is left out rather than guessed.
 * - By driver, income is placed through the trip it was entered against; income with no
 *   trip is shown as its own line. Costs belong to buses, so a driver line has no profit.
 * - By route, income and costs follow the trip's route, or the bus's route without a trip.
 */
export function incomeReport(input: {
  groupBy: GroupBy; bucket: Bucket;
  entries: ReportEntry[]; buses: ReportBus[]; trips: ReportTrip[]; costs: ReportCost[];
}) {
  const { groupBy, bucket, entries, buses, trips, costs } = input;
  const busById = new Map(buses.map((b) => [b.id, b]));
  const tripById = new Map(trips.map((t) => [t.id, t]));
  const groups = new Map<string, Acc>();
  const group = (key: string, label: string, detail?: string | null) => {
    if (!groups.has(key)) groups.set(key, blank(key, label, detail ?? null));
    return groups.get(key)!;
  };
  const busGroup = (busId: string, routeId?: string | null, routeName?: string | null) => {
    const bus = busById.get(busId);
    if (groupBy === 'bus') return group(busId, bus?.plateNo ?? 'Unknown bus', bus?.label ?? null);
    const rid = routeId !== undefined ? routeId : bus?.routeId ?? null;
    const rname = routeName !== undefined ? routeName : bus?.routeName ?? null;
    return group(rid ?? 'none', rname ?? 'No route');
  };

  for (const e of entries) {
    const trip = e.tripId ? tripById.get(e.tripId) : undefined;
    const acc = groupBy === 'driver'
      ? (trip?.driverId ? group(trip.driverId, trip.driverName ?? 'Unnamed driver') : group(UNLINKED, 'Not linked to a trip'))
      : groupBy === 'route' && trip ? busGroup(e.vehicleId, trip.routeId, trip.routeName) : busGroup(e.vehicleId);
    acc.grossPaisa += e.grossPaisa; acc.feesPaisa += e.feesPaisa; acc.netPaisa += e.netPaisa; acc.tickets += e.ticketsSold;
    const b = bucketOf(e.date, bucket);
    const point = acc.series.get(b) ?? { netPaisa: 0, tickets: 0 };
    point.netPaisa += e.netPaisa; point.tickets += e.ticketsSold;
    acc.series.set(b, point);
  }

  for (const t of trips) {
    if (t.status === 'CANCELLED') continue;
    const acc = groupBy === 'driver'
      ? (t.driverId ? group(t.driverId, t.driverName ?? 'Unnamed driver') : null)
      : groupBy === 'route' ? busGroup(t.vehicleId, t.routeId, t.routeName) : busGroup(t.vehicleId);
    if (!acc) continue;
    acc.trips += 1;
    acc.seatsOffered += busById.get(t.vehicleId)?.seatCount ?? 0;
    if (t.km != null && t.km > 0) { acc.km += t.km; acc.tripsWithKm += 1; }
  }

  if (groupBy !== 'driver') {
    for (const c of costs) busGroup(c.vehicleId).costs[c.kind] += c.npr * 100;
  }

  const rows = [...groups.values()].map((a) => {
    const costPaisa = a.costs.fuel + a.costs.maintenance + a.costs.repairs;
    return {
      key: a.key, label: a.label, detail: a.detail,
      grossPaisa: a.grossPaisa, feesPaisa: a.feesPaisa, netPaisa: a.netPaisa, tickets: a.tickets,
      trips: a.trips, km: a.km,
      occupancy: a.seatsOffered > 0 ? Math.round((a.tickets / a.seatsOffered) * 1000) / 1000 : null,
      revenuePerKmPaisa: a.km > 0 ? Math.round(a.netPaisa / a.km) : null,
      costs: groupBy === 'driver' ? null : { fuelPaisa: a.costs.fuel, maintenancePaisa: a.costs.maintenance, repairsPaisa: a.costs.repairs, totalPaisa: costPaisa },
      profitPaisa: groupBy === 'driver' ? null : a.netPaisa - costPaisa,
      series: [...a.series.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([b, v]) => ({ bucket: b, ...v })),
    };
  }).sort((x, y) => y.netPaisa - x.netPaisa || x.label.localeCompare(y.label));

  const sum = (f: (r: typeof rows[number]) => number | null | undefined) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const seatsOffered = [...groups.values()].reduce((n, a) => n + a.seatsOffered, 0);
  const km = sum((r) => r.km);
  const netPaisa = sum((r) => r.netPaisa);
  const costPaisa = groupBy === 'driver' ? null : sum((r) => r.costs?.totalPaisa);
  return {
    rows,
    totals: {
      grossPaisa: sum((r) => r.grossPaisa), feesPaisa: sum((r) => r.feesPaisa), netPaisa, tickets: sum((r) => r.tickets),
      trips: sum((r) => r.trips), km,
      occupancy: seatsOffered > 0 ? Math.round((sum((r) => r.tickets) / seatsOffered) * 1000) / 1000 : null,
      revenuePerKmPaisa: km > 0 ? Math.round(netPaisa / km) : null,
      costPaisa, profitPaisa: costPaisa == null ? null : netPaisa - costPaisa,
    },
    note: PROFIT_NOTE,
  };
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The dashboard: today, this month so far against the same days of last month (and the
 * whole of last month), best and worst bus this month, twelve months of bars and thirty
 * days of line.
 */
export function dashboard(entries: ReportEntry[], buses: ReportBus[], today: string) {
  const net = (list: ReportEntry[]) => list.reduce((n, e) => n + e.netPaisa, 0);
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const dayOfMonth = Number(today.slice(8, 10));
  const thisMonth = entries.filter((e) => e.date.startsWith(month) && e.date <= today);
  const lastMonthSameDays = entries.filter((e) => e.date.startsWith(prev) && Number(e.date.slice(8, 10)) <= dayOfMonth);
  const lastMonth = entries.filter((e) => e.date.startsWith(prev));

  const byBus = new Map<string, number>();
  for (const e of thisMonth) byBus.set(e.vehicleId, (byBus.get(e.vehicleId) ?? 0) + e.netPaisa);
  const ranked = [...byBus.entries()].sort((a, b) => b[1] - a[1]);
  const busView = (pair?: [string, number]) => {
    if (!pair) return null;
    const bus = buses.find((b) => b.id === pair[0]);
    return { id: pair[0], plateNo: bus?.plateNo ?? 'Unknown bus', label: bus?.label ?? null, netPaisa: pair[1] };
  };

  const months: string[] = [];
  for (let i = 11; i >= 0; i -= 1) months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
  const last30 = daysBetween(new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10), today);

  const sumThis = net(thisMonth);
  const sumSame = net(lastMonthSameDays);
  return {
    today: { netPaisa: net(entries.filter((e) => e.date === today)), tickets: entries.filter((e) => e.date === today).reduce((n, e) => n + e.ticketsSold, 0) },
    thisMonth: { month, netPaisa: sumThis, tickets: thisMonth.reduce((n, e) => n + e.ticketsSold, 0) },
    lastMonth: { month: prev, netPaisa: net(lastMonth), sameDaysNetPaisa: sumSame },
    /** This month so far against the same days of last month, as a fraction: 0.1 is 10% up. */
    change: sumSame > 0 ? Math.round(((sumThis - sumSame) / sumSame) * 1000) / 1000 : null,
    bestBus: busView(ranked[0]),
    worstBus: ranked.length > 1 ? busView(ranked[ranked.length - 1]) : null,
    monthly: months.map((mo) => ({ month: mo, netPaisa: net(entries.filter((e) => e.date.startsWith(mo))) })),
    daily: last30.map((d) => ({ day: d, netPaisa: net(entries.filter((e) => e.date === d)) })),
  };
}

export interface ReconSource { id: string; name: string; kind: string }

/**
 * Settlement-referenced income against unreferenced cash, per source and per day. A
 * portal entry with no settlement reference is flagged: it cannot be matched to the
 * portal's statement, and it is how the same money gets entered twice.
 */
export function reconciliation(entries: ReportEntry[], sources: ReconSource[]) {
  const kindOf = new Map(sources.map((s) => [s.id, s.kind]));
  const perSource = sources.map((s) => {
    const mine = entries.filter((e) => e.sourceId === s.id);
    const ref = mine.filter((e) => e.reference);
    const unref = mine.filter((e) => !e.reference);
    return {
      sourceId: s.id, name: s.name, kind: s.kind,
      referenced: { count: ref.length, netPaisa: ref.reduce((n, e) => n + e.netPaisa, 0) },
      unreferenced: { count: unref.length, netPaisa: unref.reduce((n, e) => n + e.netPaisa, 0) },
      missingReference: s.kind === 'PORTAL' ? unref.length : 0,
    };
  }).filter((r) => r.referenced.count || r.unreferenced.count);
  const days = [...new Set(entries.map((e) => e.date))].sort();
  const perDay = days.map((day) => {
    const list = entries.filter((e) => e.date === day);
    const portal = list.filter((e) => kindOf.get(e.sourceId) === 'PORTAL');
    const cash = list.filter((e) => kindOf.get(e.sourceId) === 'CASH');
    return {
      day,
      settledPaisa: list.filter((e) => e.reference).reduce((n, e) => n + e.netPaisa, 0),
      unreferencedCashPaisa: cash.filter((e) => !e.reference).reduce((n, e) => n + e.netPaisa, 0),
      portalPaisa: portal.reduce((n, e) => n + e.netPaisa, 0),
      portalMissingReference: portal.filter((e) => !e.reference).length,
    };
  });
  return { perSource, perDay };
}
