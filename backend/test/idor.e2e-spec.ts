import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Every fleet, finance, trip, appraisal, document and partner route, called as someone
 * who must not get in: another bus company's owner, a lower role in the same company,
 * a traveller against a partner's listing, an owner against Batoma's admin routes.
 *
 * Routes are read from the running app, not listed by hand, so a route added later is
 * tested automatically, and a route with an id parameter this file does not know fails
 * the run until someone says what it refers to.
 *
 * Every call must answer 403 or 404 and carry none of the victim's data. Writes send a
 * valid body (BODIES), so input validation cannot answer first and hide a missing check.
 */

const ACCOUNTS = readFileSync(process.env.E2E_ACCOUNTS ?? join(__dirname, '.accounts.md'), 'utf8');
const passwordOf = (email: string) => /\*\*Password\*\* \| .([^|` ]+). /.exec(ACCOUNTS.slice(ACCOUNTS.indexOf(email)))![1];
const SEED_PASSWORD = /BatoDemo#\d+/.exec(readFileSync(join(__dirname, '../prisma/seed.ts'), 'utf8'))![0];
const PREFIX = '/api/v1';

type Route = { method: string; path: string };
let app: NestExpressApplication;
let prisma: PrismaService;
let routes: Route[];
const token: Record<string, string> = {};
const id: Record<string, string> = {};
let victimName = '';
const summary: string[] = [];

async function signIn(email: string, password: string) {
  const res = await request(app.getHttpServer()).post(`${PREFIX}/auth/email/login`).send({ email, password });
  if (!res.body?.data?.accessToken) throw new Error(`Could not sign in ${email}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body.data.accessToken as string;
}

/** The victim's own record for each id in a path; null if this file does not know the parameter. */
function fill(path: string, scope: 'company' | 'partner'): string | null {
  const segments = path.split('/');
  const out: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.startsWith(':')) { out.push(seg); continue; }
    const before = segments[i - 1];
    const name = seg.slice(1);
    const value = name === 'id' ? ({
      buses: id.bus, drivers: id.driver, documents: id.busDocument, fuel: id.fuel, incidents: id.incident, maintenance: id.maintenance,
      reviews: scope === 'partner' ? null : id.feedback, companies: id.company, businesses: id.business,
    } as Record<string, string | null | undefined>)[before] : ({
      cid: id.company, aid: id.appraisal, tid: id.trip, eid: id.incomeEntry, iid: id.incomeImport, sid: id.incomeSource,
      // Someone else in the company: a member may always remove themselves (leave).
      driverId: id.driver, userId: id.crewUser, date: '2026-10-01',
      docId: scope === 'partner' ? id.businessDoc : id.companyDoc,
      couponId: id.coupon, reviewId: id.businessReview,
    } as Record<string, string | undefined>)[name];
    if (!value) return null;
    out.push(value);
  }
  return out.join('/');
}

/**
 * A valid body for each write, so the request passes input validation and reaches the
 * access check: without one, a 400 would prove nothing.
 */
const today = new Date().toISOString().slice(0, 10);
const BODIES: Array<[RegExp, () => Record<string, unknown>]> = [
  [/^POST .*\/drivers\/:id\/appraisals$/, () => ({ periodStart: '2026-07-01', periodEnd: '2026-09-30' })],
  [/^POST .*\/buses\/:id\/trips$/, () => ({ direction: 'FORWARD' })],
  [/^POST .*\/trips\/:tid\/unlock$/, () => ({ reason: 'checking access' })],
  [/^POST .*\/companies\/:cid\/buses$/, () => ({ registrationNo: 'ba 1 kha 9999', seatCount: 30 })],
  [/^(POST .*\/companies\/:cid\/drivers|PATCH .*\/drivers\/:id)$/, () => ({ name: 'Ram Bahadur', phone: '9800000001' })],
  [/^POST .*\/companies\/:cid\/members$/, () => ({ email: 'someone@example.com', role: 'MANAGER' })],
  [/^PATCH .*\/buses\/:id\/archive$/, () => ({ archived: true })],
  [/^(POST .*\/buses\/:id\/maintenance|PATCH .*\/maintenance\/:id)$/, () => ({ kind: 'ROUTINE_SERVICE', servicedAt: today, odometerKm: 1000, title: 'Oil change' })],
  [/^POST .*\/buses\/:id\/incidents$/, () => ({ kind: 'BREAKDOWN', severity: 'MINOR', occurredAt: today, description: 'Flat on the highway' })],
  [/^(POST .*\/buses\/:id\/documents|PATCH .*\/fleet\/documents\/:id)$/, () => ({ type: 'INSURANCE' })],
  [/^POST .*\/buses\/:id\/fuel$/, () => ({ filledAt: today, odometerKm: 1000, litres: 40, costNpr: 6000 })],
  [/^POST .*\/buses\/:id\/crew$/, () => ({ driverId: id.driver })],
  [/^PATCH .*\/incidents\/:id\/resolve$/, () => ({ resolutionNote: 'Fixed' })],
  [/^POST .*\/fleet\/reviews\/:id\/reply$/, () => ({ reply: 'Thank you' })],
  [/^POST .*\/fleet\/reviews\/:id\/report$/, () => ({ reason: 'SPAM' })],
  [/^POST .*\/companies\/:cid\/income\/sources$/, () => ({ name: 'Counter cash two' })],
  [/^PUT .*\/buses\/:id\/income\/:date$/, () => ({ rows: [] })],
  [/^POST .*\/companies\/:cid\/income\/import(\/preview)?$/, () => ({ sourceId: id.incomeSource })],
  [/^POST .*\/(companies|businesses)\/:id\/documents$/, () => ({ kind: 'PAN' })],
  [/^PATCH .*\/businesses\/:id$/, () => ({ description: 'changed' })],
  [/^POST .*\/businesses\/:id\/coupons$/, () => ({ title: 'Free tea', discountLabel: 'Free tea', validTo: '2027-01-01' })],
  [/^PATCH .*\/businesses\/reviews\/:reviewId\/reply$/, () => ({ reply: 'Thank you' })],
  [/^PATCH .*\/businesses\/:id\/routes$/, () => ({ routeIds: [] })],
];

async function call(method: string, path: string, who: string, routePath = path) {
  const r = request(app.getHttpServer())[method.toLowerCase() as 'get'](path).set('Authorization', `Bearer ${token[who]}`);
  if (method === 'GET') return r;
  const body = BODIES.find(([re]) => re.test(`${method} ${routePath}`))?.[1]() ?? {};
  return r.send(body);
}

/** Calls each route as `who`; returns every answer that let them in. */
async function probe(list: Route[], who: string, scope: 'company' | 'partner', opts: { allowed?: RegExp[] } = {}) {
  const failures: string[] = [];
  const unknown: string[] = [];
  const counts = { refused: 0, invalid: 0 };
  for (const r of list) {
    if (opts.allowed?.some((re) => re.test(`${r.method} ${r.path}`))) continue;
    const path = fill(r.path, scope);
    if (!path) { unknown.push(`${r.method} ${r.path}`); continue; }
    const res = await call(r.method, path, who, r.path);
    const body = JSON.stringify(res.body ?? '') + (res.text ?? '');
    const leaked = res.status < 400 || (victimName && body.includes(victimName) && res.status !== 400);
    // Every write carries a valid body (BODIES), so the access check must answer first.
    const okStatus = [403, 404].includes(res.status);
    if (!okStatus || leaked) failures.push(`${r.method} ${r.path} → ${res.status} ${body.slice(0, 120)}`);
    else if (res.status === 400) { counts.invalid += 1; if (process.env.E2E_VERBOSE) summary.push(`  400 for ${who}: ${r.method} ${r.path} ${String(res.body?.message ?? '').slice(0, 80)}`); }
    else counts.refused += 1;
  }
  summary.push(`${who}: ${counts.refused} refused (403/404), ${counts.invalid} stopped by input validation (400), ${failures.length} let in`);
  return { failures, unknown };
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  const stack = (app.getHttpAdapter().getInstance() as unknown as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } }).router.stack;
  routes = stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route!.methods).map((m) => ({ method: m.toUpperCase(), path: l.route!.path })));

  token.owner = await signIn('owner.fleet@bato.test', passwordOf('owner.fleet@bato.test'));
  token.manager = await signIn('manager.fleet@bato.test', passwordOf('manager.fleet@bato.test'));
  token.crew = await signIn('crew.fleet@bato.test', passwordOf('crew.fleet@bato.test'));
  token.otherOwner = await signIn('owner.single@bato.test', passwordOf('owner.single@bato.test'));
  token.traveller = await signIn('traveller@bato.test', passwordOf('traveller@bato.test'));
  token.partner = await signIn('business-owner@demo.bato.travel', SEED_PASSWORD);

  // The victim: the test fleet company, and the demo partner's listing.
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner.fleet@bato.test' } });
  const link = await prisma.operatorAdmin.findFirstOrThrow({ where: { userId: owner.id, role: 'OWNER' }, include: { operator: true } });
  id.company = link.operatorId;
  victimName = link.operator.name;
  id.manager = (await prisma.user.findUniqueOrThrow({ where: { email: 'manager.fleet@bato.test' } })).id;
  id.crewUser = (await prisma.user.findUniqueOrThrow({ where: { email: 'crew.fleet@bato.test' } })).id;
  const bus = await prisma.vehicle.findFirstOrThrow({ where: { operatorId: id.company, isActive: true } });
  id.bus = bus.id;
  id.driver = (await prisma.driver.findFirstOrThrow({ where: { operatorId: id.company } })).id;
  id.trip = (await prisma.trip.findFirstOrThrow({ where: { operatorId: id.company } })).id;
  const byBus = { vehicle: { operatorId: id.company } };
  id.busDocument = (await prisma.busDocument.findFirstOrThrow({ where: byBus })).id;
  id.fuel = (await prisma.fuelLog.findFirstOrThrow({ where: byBus })).id;
  id.maintenance = (await prisma.maintenanceRecord.findFirstOrThrow({ where: byBus })).id;
  id.incident = (await prisma.busIncident.findFirst({ where: byBus }))?.id
    ?? (await prisma.busIncident.create({ data: { vehicleId: id.bus, occurredAt: new Date(), description: 'e2e' } })).id;
  id.feedback = (await prisma.rideFeedback.findFirst({ where: { vehicleId: id.bus } }))?.id
    ?? (await prisma.rideFeedback.create({ data: { vehicleId: id.bus, overall: 4 } })).id;
  id.incomeSource = (await prisma.incomeSource.findFirstOrThrow({ where: { operatorId: id.company } })).id;
  id.incomeEntry = (await prisma.incomeEntry.findFirstOrThrow({ where: { operatorId: id.company } })).id;
  id.incomeImport = (await prisma.incomeImport.findFirst({ where: { operatorId: id.company } }))?.id
    ?? (await prisma.incomeImport.create({ data: { operatorId: id.company, sourceId: id.incomeSource, filename: 'e2e.csv', format: 'csv', rows: 0, created: 0, duplicates: 0, invalid: 0, mapping: {} } })).id;
  id.appraisal = (await prisma.driverAppraisal.findFirst({ where: { operatorId: id.company } }))?.id
    ?? (await prisma.driverAppraisal.create({ data: { operatorId: id.company, driverId: id.driver, periodStart: new Date('2026-07-01'), periodEnd: new Date('2026-09-30') } })).id;
  id.companyDoc = (await prisma.verificationDocument.create({
    data: { operatorId: id.company, kind: 'PAN', storageKey: `verification/${id.company}/${randomUUID()}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, uploadedById: owner.id },
  })).id;

  const partner = await prisma.user.findUniqueOrThrow({ where: { email: 'business-owner@demo.bato.travel' } });
  const business = await prisma.business.findFirstOrThrow({ where: { ownerId: partner.id, verifiedAt: { not: null } } });
  id.business = business.id;
  id.coupon = (await prisma.coupon.findFirstOrThrow({ where: { businessId: business.id } })).id;
  const traveller = await prisma.user.findUniqueOrThrow({ where: { email: 'traveller@bato.test' } });
  id.businessReview = (await prisma.review.upsert({
    where: { businessId_userId: { businessId: business.id, userId: traveller.id } },
    create: { businessId: business.id, userId: traveller.id, rating: 5, body: 'e2e', moderation: 'APPROVED' }, update: {},
  })).id;
  id.businessDoc = (await prisma.verificationDocument.create({
    data: { businessId: business.id, kind: 'BUSINESS_LICENCE', storageKey: `verification/${business.id}/${randomUUID()}.pdf`, mimeType: 'application/pdf', sizeBytes: 1, uploadedById: partner.id },
  })).id;
});

afterAll(async () => {
  if (summary.length) console.log(`IDOR suite:\n  ${summary.join('\n  ')}`);
  await app?.close();
});

const fleetRoutes = () => routes.filter((r) => r.path.startsWith(`${PREFIX}/fleet/`) && !r.path.startsWith(`${PREFIX}/fleet/admin/`) && r.path.includes(':'));

it('reads the routes from the app', () => {
  expect(fleetRoutes().length).toBeGreaterThan(80);
});

it('another bus company gets nothing from any fleet, trip, appraisal, finance or document route', async () => {
  const { failures, unknown } = await probe(fleetRoutes(), 'otherOwner', 'company');
  expect(unknown).toEqual([]);
  expect(failures).toEqual([]);
});

it('a conductor (crew) reaches only the duty screen and starting or ending a trip', async () => {
  const { failures, unknown } = await probe(fleetRoutes(), 'crew', 'company', {
    allowed: [/^GET .*\/companies\/:cid\/duty$/, /^POST .*\/buses\/:id\/trips$/, /^POST .*\/trips\/:tid\/end$/],
  });
  expect(unknown).toEqual([]);
  expect(failures).toEqual([]);
});

it('a manager cannot do what only owners may', async () => {
  const ownerOnly = fleetRoutes().filter((r) => [
    /^PATCH .*\/companies\/:cid$/, /^POST .*\/companies\/:cid\/members$/, /^DELETE .*\/companies\/:cid\/members\/:userId$/,
    /^DELETE .*\/buses\/:id$/, /^PATCH .*\/companies\/:cid\/finance$/, /^POST .*\/companies\/:cid\/income\/sources$/,
    /^PATCH .*\/income\/sources\/:sid$/, /^GET .*\/companies\/:cid\/leaderboard$/, /^POST .*\/trips\/:tid\/unlock$/,
    /^(GET|POST|DELETE) .*\/companies\/:id\/documents/,
  ].some((re) => re.test(`${r.method} ${r.path}`)));
  expect(ownerOnly.length).toBeGreaterThanOrEqual(12);
  const { failures, unknown } = await probe(ownerOnly, 'manager', 'company');
  expect(unknown).toEqual([]);
  expect(failures).toEqual([]);
});

it("a traveller gets nothing from a partner's own routes", async () => {
  const partnerRoutes = routes.filter((r) =>
    /^\/api\/v1\/businesses\/(:id\/|coupons\/:couponId\/end|reviews\/:reviewId)/.test(r.path)
    // Open to anyone on purpose: recording a tap or call, writing a review, claiming a deal.
    && !/\/(lead|reviews|claim)$/.test(r.path));
  expect(partnerRoutes.length).toBeGreaterThanOrEqual(14);
  victimName = '';
  const { failures, unknown } = await probe(partnerRoutes, 'traveller', 'partner');
  expect(unknown).toEqual([]);
  expect(failures).toEqual([]);
});

it("a bus company owner and a partner get nothing from Batoma's admin routes", async () => {
  // Reporting content (moderation/report) is open to everyone on purpose; the rest is staff only.
  const adminRoutes = routes.filter((r) => /^\/api\/v1\/(admin\/|fleet\/admin\/|businesses\/admin\/|ads\/admin|qr\/batch|users\/admin|moderation\/(?!report$)|programming\/|magazine\/admin\/|guides\/admin|creators\/admin|events(?:\/|$)|stories\/admin)/.test(r.path));
  expect(adminRoutes.length).toBeGreaterThan(20);
  for (const who of ['owner', 'partner']) {
    const failures: string[] = [];
    for (const r of adminRoutes) {
      const path = r.path.replace(/:(\w+)/g, () => randomUUID());
      const res = await call(r.method, path, who);
      if (![403, 404].includes(res.status)) failures.push(`${who}: ${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  }
});

it('the victim still sees their own records (the ids are real)', async () => {
  for (const path of [`/fleet/buses/${id.bus}`, `/fleet/trips/${id.trip}`, `/fleet/appraisals/${id.appraisal}`, `/fleet/companies/${id.company}/documents`]) {
    const res = await call('GET', `${PREFIX}${path}`, 'owner');
    expect([path, res.status]).toEqual([path, 200]);
  }
  const res = await call('GET', `${PREFIX}/businesses/${id.business}/leads`, 'partner');
  expect(res.status).toBe(200);
});
