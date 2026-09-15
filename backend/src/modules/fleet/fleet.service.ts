import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  BusStatus, DriverRole, MaintenanceKind, ModerationStatus, Operator, OperatorMemberRole,
  OperatorVerification, Prisma, QrCode, QrKind, Vehicle,
} from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../common/prisma/prisma.service';
import { uniqueSlug } from '../../common/utils/slug.util';
import { FleetAccessService } from './fleet-access.service';
import {
  AddMemberDto, BusListQueryDto, CreateBusDto, CreateCompanyDto, UpdateBusDto, UpdateCompanyDto,
} from './dto/fleet.dto';
import {
  DAY_MS, expiry, ExpiryState, mileage, normalisePlate, plateLooksValid, profileCode, round1,
  serviceDue, ServiceDue, tidyPlate,
} from './fleet.util';

type BusWithRoute = Vehicle & { route?: { id: string; name: string; code: string } | null };

export interface Reminder {
  key: string;
  severity: 'high' | 'medium' | 'low';
  kind: string;
  title: string;
  detail: string;
  busId?: string;
  registrationNo?: string;
  driverId?: string;
  dueDate?: Date | null;
  daysLeft?: number | null;
}

const MAX_OWNED_COMPANIES = 10;
const MAX_BUSES_PER_COMPANY = 2000;
const PAGE = 25;

export const DOCUMENT_LABEL: Record<string, string> = {
  BLUEBOOK: 'Bluebook', ROUTE_PERMIT: 'Route permit', INSURANCE: 'Insurance',
  POLLUTION_CERTIFICATE: 'Pollution certificate', FITNESS_CERTIFICATE: 'Fitness certificate',
  TAX_CLEARANCE: 'Tax clearance', OTHER: 'Document',
};

const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : 'none');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function companyView(o: Operator) {
  return {
    id: o.id, name: o.name, slug: o.slug, logoUrl: o.logoUrl, contactPhone: o.contactPhone,
    contactEmail: o.contactEmail, address: o.address, registrationNo: o.registrationNo,
    description: o.description, verification: o.verification, verifiedAt: o.verifiedAt,
    verificationNote: o.verificationNote, isActive: o.isActive, createdAt: o.createdAt,
  };
}

export function busView(b: BusWithRoute) {
  return {
    id: b.id, operatorId: b.operatorId, registrationNo: b.plateNo, label: b.label, seatCount: b.seatCount,
    make: b.make, model: b.model, year: b.year, busType: b.busType, colour: b.colour, amenities: b.amenities,
    photoUrl: b.photoUrl, status: b.status, odometerKm: b.odometerKm, serviceIntervalKm: b.serviceIntervalKm,
    serviceIntervalDays: b.serviceIntervalDays, isActive: b.isActive, routeId: b.routeId,
    route: b.route ?? null, createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

@Injectable()
export class FleetService {
  constructor(private prisma: PrismaService, private access: FleetAccessService) {}

  // ================= companies =================

  async myCompanies(userId: string) {
    const links = await this.prisma.operatorAdmin.findMany({
      where: { userId },
      include: {
        operator: { include: { _count: { select: { vehicles: { where: { isActive: true } } } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return links.map((l) => ({ ...companyView(l.operator), role: l.role, busCount: l.operator._count.vehicles }));
  }

  async createCompany(dto: CreateCompanyDto, userId: string) {
    const owned = await this.prisma.operatorAdmin.count({ where: { userId, role: OperatorMemberRole.OWNER } });
    if (owned >= MAX_OWNED_COMPANIES) {
      throw new BadRequestException(`An account can own up to ${MAX_OWNED_COMPANIES} companies. Contact Bato to add more.`);
    }
    this.access.assertMedia(dto.logoUrl);
    const slug = await uniqueSlug(dto.name, async (s) =>
      !!(await this.prisma.operator.findUnique({ where: { slug: s }, select: { id: true } })));

    const operator = await this.prisma.$transaction(async (tx) => {
      const created = await tx.operator.create({
        data: {
          name: dto.name, slug, contactPhone: dto.contactPhone, contactEmail: dto.contactEmail?.toLowerCase(),
          registrationNo: dto.registrationNo, address: dto.address, description: dto.description,
          logoUrl: dto.logoUrl, verification: OperatorVerification.PENDING,
        },
      });
      await tx.operatorAdmin.create({ data: { operatorId: created.id, userId, role: OperatorMemberRole.OWNER } });
      await tx.qrCode.create({
        data: { shortCode: profileCode(), operatorId: created.id, kind: QrKind.COMPANY, placement: 'COMPANY_PROFILE' },
      });
      await tx.fleetNotification.create({
        data: {
          operatorId: created.id, kind: 'VERIFICATION', title: 'Company registered',
          body: 'Bato checks new companies, usually within two working days. Add your buses now; passengers can see them and scan their QR codes once you are verified.',
          dedupeKey: `verification:${created.id}:PENDING:${Date.now()}`,
        },
      });
      return created;
    });
    return { ...companyView(operator), role: OperatorMemberRole.OWNER, busCount: 0 };
  }

  async company(operatorId: string, userId: string) {
    const { operator, role } = await this.access.company(operatorId, userId);
    const members = await this.prisma.operatorAdmin.findMany({
      where: { operatorId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...companyView(operator), role,
      members: members.map((m) => ({
        userId: m.user.id, name: m.user.name, email: m.user.email, role: m.role, since: m.createdAt,
      })),
    };
  }

  async updateCompany(operatorId: string, dto: UpdateCompanyDto, userId: string) {
    const { operator } = await this.access.company(operatorId, userId, 'OWN');
    const clear = (v: string | undefined) => (v === undefined ? undefined : v || null);
    if (dto.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dto.contactEmail)) {
      throw new BadRequestException('Enter a valid contact email');
    }
    if (dto.logoUrl) this.access.assertMedia(dto.logoUrl);

    const data: Prisma.OperatorUpdateInput = {
      name: dto.name,
      contactPhone: dto.contactPhone,
      contactEmail: clear(dto.contactEmail?.toLowerCase()),
      registrationNo: clear(dto.registrationNo),
      address: clear(dto.address),
      description: clear(dto.description),
      logoUrl: clear(dto.logoUrl),
    };

    // A verified badge vouches for a name and registration number. Change either and Bato checks again.
    const identityChanged =
      (dto.name !== undefined && dto.name !== operator.name) ||
      (dto.registrationNo !== undefined && (dto.registrationNo || null) !== operator.registrationNo);
    if (operator.verification === OperatorVerification.REJECTED) {
      Object.assign(data, { verification: OperatorVerification.PENDING, verifiedAt: null, verificationNote: 'Resubmitted with changes' });
    } else if (operator.verification === OperatorVerification.VERIFIED && identityChanged) {
      Object.assign(data, {
        verification: OperatorVerification.PENDING, verifiedAt: null,
        verificationNote: 'Company name or registration number changed, so Bato is checking again',
      });
    }

    await this.prisma.operator.update({ where: { id: operatorId }, data });
    return this.company(operatorId, userId);
  }

  async addMember(operatorId: string, dto: AddMemberDto, userId: string) {
    await this.access.company(operatorId, userId, 'OWN');
    const person = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: { id: true, emailVerifiedAt: true, isSuspended: true },
    });
    if (!person?.emailVerifiedAt || person.isSuspended) {
      throw new NotFoundException('No confirmed Bato account uses that email. Ask them to create one in the owner portal first.');
    }
    if (person.id === userId) throw new BadRequestException('You are already part of this company.');

    await this.prisma.operatorAdmin.upsert({
      where: { operatorId_userId: { operatorId, userId: person.id } },
      update: { role: dto.role },
      create: { operatorId, userId: person.id, role: dto.role },
    });
    return this.company(operatorId, userId);
  }

  async removeMember(operatorId: string, memberId: string, userId: string) {
    // Anyone may leave; only an owner may remove someone else.
    await this.access.company(operatorId, userId, memberId === userId ? 'VIEW' : 'OWN');
    const link = await this.prisma.operatorAdmin.findUnique({
      where: { operatorId_userId: { operatorId, userId: memberId } },
    });
    if (!link) throw new NotFoundException('That person is not part of this company.');
    if (link.role === OperatorMemberRole.OWNER) {
      const owners = await this.prisma.operatorAdmin.count({ where: { operatorId, role: OperatorMemberRole.OWNER } });
      if (owners <= 1) throw new BadRequestException('A company needs at least one owner. Make someone else an owner first.');
    }
    await this.prisma.operatorAdmin.delete({ where: { operatorId_userId: { operatorId, userId: memberId } } });
    return { removed: true };
  }

  // ================= buses =================

  private async assertRoute(routeId?: string | null) {
    if (!routeId) return;
    const route = await this.prisma.route.findUnique({ where: { id: routeId }, select: { id: true } });
    if (!route) throw new BadRequestException('Choose a route from the list.');
  }

  private plateTaken(): ConflictException {
    return new ConflictException({
      code: 'PLATE_TAKEN',
      message: 'This registration number is already registered on Bato. If it is your bus, contact Bato support to have it transferred.',
    });
  }

  private checkedPlate(raw: string) {
    const key = normalisePlate(raw);
    if (!plateLooksValid(key)) {
      throw new BadRequestException('That does not look like a registration number. Include the numbers from the plate.');
    }
    return { plateNo: tidyPlate(raw), plateKey: key };
  }

  async createBus(operatorId: string, dto: CreateBusDto, userId: string) {
    await this.access.company(operatorId, userId, 'MANAGE');
    const plate = this.checkedPlate(dto.registrationNo);
    this.access.assertMedia(dto.photoUrl);
    await this.assertRoute(dto.routeId);

    const [existing, count] = await Promise.all([
      this.prisma.vehicle.findUnique({ where: { plateKey: plate.plateKey }, select: { id: true } }),
      this.prisma.vehicle.count({ where: { operatorId } }),
    ]);
    if (existing) throw this.plateTaken();
    if (count >= MAX_BUSES_PER_COMPANY) throw new BadRequestException('This company has reached the bus limit. Contact Bato.');

    try {
      const bus = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vehicle.create({
          data: {
            operatorId, ...plate, label: dto.label, seatCount: dto.seatCount, make: dto.make, model: dto.model,
            year: dto.year, busType: dto.busType, colour: dto.colour, amenities: dto.amenities ?? [],
            routeId: dto.routeId, photoUrl: dto.photoUrl, odometerKm: dto.odometerKm ?? 0,
            serviceIntervalKm: dto.serviceIntervalKm ?? 10_000, serviceIntervalDays: dto.serviceIntervalDays ?? 90,
            status: dto.status ?? BusStatus.ACTIVE,
          },
        });
        await tx.qrCode.create({
          data: {
            shortCode: profileCode(), operatorId, vehicleId: created.id, routeId: created.routeId,
            kind: QrKind.BUS, placement: 'BUS_PROFILE',
          },
        });
        return created;
      });
      return this.bus(bus.id, userId);
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') throw this.plateTaken();
      throw e;
    }
  }

  async listBuses(operatorId: string, q: BusListQueryDto, userId: string) {
    await this.access.company(operatorId, userId);
    const page = q.page ?? 1;
    const text = q.q?.trim();
    const where: Prisma.VehicleWhereInput = {
      operatorId,
      isActive: q.archived !== 'true',
      ...(q.status ? { status: q.status } : {}),
      ...(text ? {
        OR: [
          ...(normalisePlate(text) ? [{ plateKey: { contains: normalisePlate(text) } }] : []),
          { label: { contains: text, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const [total, buses] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where, orderBy: { plateKey: 'asc' }, skip: (page - 1) * PAGE, take: PAGE,
        include: { route: { select: { id: true, name: true, code: true } } },
      }),
    ]);
    return {
      items: await this.summarise(buses),
      meta: { total, page, pages: Math.max(1, Math.ceil(total / PAGE)) },
    };
  }

  /**
   * Service, documents, satisfaction, incidents, crew and fuel economy for a set
   * of buses in a fixed number of queries, however large the fleet.
   */
  async summarise(buses: BusWithRoute[], now = new Date()) {
    const ids = buses.map((b) => b.id);
    if (!ids.length) return [];
    const [services, docs, ratings, satisfied, incidents, crew, fuel] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({
        where: { vehicleId: { in: ids }, kind: MaintenanceKind.ROUTINE_SERVICE },
        orderBy: [{ vehicleId: 'asc' }, { servicedAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['vehicleId'],
        select: { vehicleId: true, servicedAt: true, odometerKm: true, nextDueDate: true, nextDueKm: true },
      }),
      this.prisma.busDocument.findMany({
        where: { vehicleId: { in: ids }, expiresAt: { not: null } },
        select: { id: true, vehicleId: true, type: true, expiresAt: true, number: true },
      }),
      this.prisma.rideFeedback.groupBy({
        by: ['vehicleId'], where: { vehicleId: { in: ids }, moderation: ModerationStatus.APPROVED },
        _avg: { overall: true }, _count: { _all: true },
      }),
      this.prisma.rideFeedback.groupBy({
        by: ['vehicleId'], where: { vehicleId: { in: ids }, moderation: ModerationStatus.APPROVED, overall: { gte: 4 } },
        _count: { _all: true },
      }),
      this.prisma.busIncident.groupBy({
        by: ['vehicleId'], where: { vehicleId: { in: ids }, status: 'OPEN' }, _count: { _all: true },
      }),
      this.prisma.driverAssignment.findMany({
        where: { vehicleId: { in: ids }, endedAt: null },
        include: { driver: { select: { id: true, name: true, role: true, phone: true } } },
      }),
      this.prisma.fuelLog.findMany({
        where: { vehicleId: { in: ids }, filledAt: { gte: new Date(now.getTime() - 180 * DAY_MS) } },
        select: { vehicleId: true, filledAt: true, odometerKm: true, litres: true, costNpr: true, fullTank: true },
      }),
    ]);

    return buses.map((b) => {
      // A renewed document supersedes the old one of the same type, so only the latest expiry counts.
      const latest = new Map<string, (typeof docs)[number]>();
      for (const d of docs.filter((x) => x.vehicleId === b.id)) {
        const prev = latest.get(d.type);
        if (!prev || d.expiresAt > prev.expiresAt) latest.set(d.type, d);
      }
      const documents = [...latest.values()]
        .map((d) => ({ id: d.id, type: d.type, number: d.number, expiresAt: d.expiresAt, ...expiry(d.expiresAt, now) }))
        .sort((x, y) => (x.daysLeft ?? 0) - (y.daysLeft ?? 0));
      const rating = ratings.find((r) => r.vehicleId === b.id);
      const reviews = rating?._count._all ?? 0;
      const good = satisfied.find((r) => r.vehicleId === b.id)?._count._all ?? 0;
      const economy = mileage(fuel.filter((f) => f.vehicleId === b.id));

      return {
        ...busView(b),
        service: serviceDue(b, services.find((s) => s.vehicleId === b.id), now),
        documents: {
          items: documents,
          expired: documents.filter((d) => d.state === 'EXPIRED').length,
          expiring: documents.filter((d) => d.state === 'EXPIRING').length,
        },
        rating: { average: round1(rating?._avg.overall), reviews, satisfaction: reviews ? Math.round((good / reviews) * 100) : null },
        openIncidents: incidents.find((i) => i.vehicleId === b.id)?._count._all ?? 0,
        crew: crew.filter((a) => a.vehicleId === b.id).map((a) => ({ ...a.driver, since: a.startedAt })),
        fuel: { kmPerLitre: economy.kmPerLitre, costPerKm: economy.costPerKm },
      };
    });
  }

  /** Everything that needs doing, most urgent first. Also drives the nightly reminder emails. */
  reminders(
    rows: Awaited<ReturnType<FleetService['summarise']>>,
    drivers: Array<{ id: string; name: string; licenceExpiresAt: Date | null }>,
    now = new Date(),
  ): Reminder[] {
    const items: Reminder[] = [];
    for (const r of rows) {
      const s: ServiceDue = r.service;
      const bus = { busId: r.id, registrationNo: r.registrationNo };
      if (s.state === 'OVERDUE') {
        const late = s.daysLeft < 0 && s.kmLeft < 0
          ? `${plural(-s.daysLeft, 'day')} and ${(-s.kmLeft).toLocaleString('en')} km overdue`
          : s.daysLeft < 0 ? `${plural(-s.daysLeft, 'day')} overdue` : `${(-s.kmLeft).toLocaleString('en')} km overdue`;
        items.push({
          ...bus, key: `svc:${r.id}:${isoDay(s.nextDueDate)}:${s.nextDueKm}:OVERDUE`, severity: 'high',
          kind: 'SERVICE_OVERDUE', title: `Service overdue: ${r.registrationNo}`, detail: late,
          dueDate: s.nextDueDate, daysLeft: s.daysLeft,
        });
      } else if (s.state === 'DUE_SOON') {
        items.push({
          ...bus, key: `svc:${r.id}:${isoDay(s.nextDueDate)}:${s.nextDueKm}:DUE_SOON`, severity: 'medium',
          kind: 'SERVICE_DUE', title: `Service due soon: ${r.registrationNo}`,
          detail: `Due in ${plural(Math.max(0, s.daysLeft), 'day')} or ${Math.max(0, s.kmLeft).toLocaleString('en')} km, whichever comes first`,
          dueDate: s.nextDueDate, daysLeft: s.daysLeft,
        });
      } else if (s.state === 'NO_RECORD') {
        items.push({
          ...bus, key: `svc:${r.id}:none`, severity: 'low', kind: 'SERVICE_UNKNOWN',
          title: `No service recorded: ${r.registrationNo}`,
          detail: 'Add the last service so Bato can remind you when the next one is due', daysLeft: null,
        });
      }
      for (const d of r.documents.items) {
        if (d.state !== 'EXPIRED' && d.state !== 'EXPIRING') continue;
        const label = DOCUMENT_LABEL[d.type] ?? 'Document';
        items.push({
          ...bus, key: `doc:${r.id}:${d.type}:${isoDay(d.expiresAt)}:${d.state}`,
          severity: d.state === 'EXPIRED' ? 'high' : 'medium',
          kind: d.state === 'EXPIRED' ? 'DOCUMENT_EXPIRED' : 'DOCUMENT_EXPIRING',
          title: `${label} ${d.state === 'EXPIRED' ? 'expired' : 'expiring'}: ${r.registrationNo}`,
          detail: d.state === 'EXPIRED' ? `Expired ${plural(-d.daysLeft, 'day')} ago` : `Expires in ${plural(d.daysLeft, 'day')}`,
          dueDate: d.expiresAt, daysLeft: d.daysLeft,
        });
      }
      if (r.openIncidents) {
        items.push({
          ...bus, key: `inc:${r.id}:${r.openIncidents}`, severity: 'high', kind: 'INCIDENT_OPEN',
          title: `Unresolved breakdown: ${r.registrationNo}`,
          detail: `${plural(r.openIncidents, 'incident')} still open`, daysLeft: null,
        });
      }
    }
    for (const d of drivers) {
      const e = expiry(d.licenceExpiresAt, now);
      if (e.state !== 'EXPIRED' && e.state !== 'EXPIRING') continue;
      items.push({
        key: `lic:${d.id}:${isoDay(d.licenceExpiresAt)}:${e.state}`, driverId: d.id,
        severity: e.state === 'EXPIRED' ? 'high' : 'medium',
        kind: e.state === 'EXPIRED' ? 'LICENCE_EXPIRED' : 'LICENCE_EXPIRING',
        title: `Driving licence ${e.state === 'EXPIRED' ? 'expired' : 'expiring'}: ${d.name}`,
        detail: e.state === 'EXPIRED' ? `Expired ${plural(-e.daysLeft, 'day')} ago` : `Expires in ${plural(e.daysLeft, 'day')}`,
        dueDate: d.licenceExpiresAt, daysLeft: e.daysLeft,
      });
    }
    const weight = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => weight[a.severity] - weight[b.severity] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  }

  async bus(id: string, userId: string) {
    const { role } = await this.access.bus(id, userId);
    const bus = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        route: { select: { id: true, name: true, code: true } },
        operator: { select: { id: true, name: true, verification: true, isActive: true } },
      },
    });
    const [[row], documents, recentService, counts] = await Promise.all([
      this.summarise([bus]),
      this.prisma.busDocument.findMany({ where: { vehicleId: id }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }] }),
      this.prisma.maintenanceRecord.findMany({ where: { vehicleId: id }, orderBy: { servicedAt: 'desc' }, take: 3 }),
      Promise.all([
        this.prisma.maintenanceRecord.count({ where: { vehicleId: id } }),
        this.prisma.busIncident.count({ where: { vehicleId: id } }),
        this.prisma.fuelLog.count({ where: { vehicleId: id } }),
        this.prisma.rideFeedback.count({ where: { vehicleId: id } }),
      ]),
    ]);
    const isPublic = bus.isActive && bus.operator.isActive && bus.operator.verification === OperatorVerification.VERIFIED;
    return {
      ...row,
      role,
      company: bus.operator,
      publicUrl: isPublic ? this.access.webUrl(`bus.html?id=${id}`) : null,
      documentsList: documents.map((d) => ({ ...d, ...expiry(d.expiresAt) })),
      recentService,
      counts: { maintenance: counts[0], incidents: counts[1], fuel: counts[2], reviews: counts[3] },
    };
  }

  async updateBus(id: string, dto: UpdateBusDto, userId: string) {
    const { bus } = await this.access.bus(id, userId, 'MANAGE');
    const data: Prisma.VehicleUncheckedUpdateInput = {};

    if (dto.registrationNo !== undefined) {
      const plate = this.checkedPlate(dto.registrationNo);
      if (plate.plateKey !== bus.plateKey) {
        const taken = await this.prisma.vehicle.findUnique({ where: { plateKey: plate.plateKey }, select: { id: true } });
        if (taken) throw this.plateTaken();
      }
      Object.assign(data, plate);
    }
    if (dto.routeId !== undefined) {
      await this.assertRoute(dto.routeId || null);
      data.routeId = dto.routeId || null;
    }
    if (dto.photoUrl !== undefined) {
      if (dto.photoUrl) this.access.assertMedia(dto.photoUrl);
      data.photoUrl = dto.photoUrl || null;
    }
    for (const key of ['label', 'make', 'model', 'colour'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key] || null;
    }
    for (const key of ['seatCount', 'year', 'busType', 'amenities', 'odometerKm', 'serviceIntervalKm', 'serviceIntervalDays', 'status'] as const) {
      if (dto[key] !== undefined) (data as Record<string, unknown>)[key] = dto[key];
    }

    try {
      await this.prisma.vehicle.update({ where: { id }, data });
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') throw this.plateTaken();
      throw e;
    }
    return this.bus(id, userId);
  }

  /** Archived buses leave public search, and their QR codes stop resolving until restored. */
  async archiveBus(id: string, archived: boolean, userId: string) {
    await this.access.bus(id, userId, 'OWN');
    await this.prisma.$transaction([
      this.prisma.vehicle.update({ where: { id }, data: { isActive: !archived } }),
      ...(archived
        ? [this.prisma.driverAssignment.updateMany({ where: { vehicleId: id, endedAt: null }, data: { endedAt: new Date() } })]
        : []),
    ]);
    return { archived };
  }

  /** Deleting erases the bus's whole history, so it has to be archived first. */
  async deleteBus(id: string, userId: string) {
    const { bus } = await this.access.bus(id, userId, 'OWN');
    if (bus.isActive) {
      throw new BadRequestException('Archive the bus first. Deleting it removes its whole history, including reviews.');
    }
    await this.prisma.vehicle.delete({ where: { id } });
    return { deleted: true };
  }

  // ================= QR codes =================

  private async qrView(qr: QrCode, title: string, subtitle: string | null) {
    const url = this.access.webUrl(`bus.html?code=${qr.shortCode}`);
    const [svg, scans] = await Promise.all([
      QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#1C1A2E', light: '#FFFFFF' } }),
      this.prisma.scanEvent.count({ where: { qrCodeId: qr.id } }),
    ]);
    return { id: qr.id, code: qr.shortCode, kind: qr.kind, url, svg, scans, createdAt: qr.createdAt, title, subtitle };
  }

  private newQr(operatorId: string, kind: QrKind, vehicleId?: string, routeId?: string | null) {
    return this.prisma.qrCode.create({
      data: {
        shortCode: profileCode(), operatorId, vehicleId, routeId, kind,
        placement: kind === QrKind.BUS ? 'BUS_PROFILE' : 'COMPANY_PROFILE', printedAt: new Date(),
      },
    });
  }

  async busQr(id: string, userId: string) {
    const { bus } = await this.access.bus(id, userId);
    const qr = await this.prisma.qrCode.findFirst({
      where: { vehicleId: id, kind: QrKind.BUS, isActive: true }, orderBy: { createdAt: 'desc' },
    }) ?? await this.newQr(bus.operatorId, QrKind.BUS, id, bus.routeId);
    return this.qrView(qr, bus.plateNo, bus.label);
  }

  /** For a copied or damaged sticker: the old code stops working at once. */
  async rotateBusQr(id: string, userId: string) {
    const { bus } = await this.access.bus(id, userId, 'MANAGE');
    await this.prisma.qrCode.updateMany({
      where: { vehicleId: id, kind: QrKind.BUS, isActive: true }, data: { isActive: false, replacedAt: new Date() },
    });
    const qr = await this.newQr(bus.operatorId, QrKind.BUS, id, bus.routeId);
    return this.qrView(qr, bus.plateNo, bus.label);
  }

  async companyQr(operatorId: string, userId: string) {
    const { operator } = await this.access.company(operatorId, userId);
    const qr = await this.prisma.qrCode.findFirst({
      where: { operatorId, kind: QrKind.COMPANY, isActive: true }, orderBy: { createdAt: 'desc' },
    }) ?? await this.newQr(operatorId, QrKind.COMPANY);
    return this.qrView(qr, operator.name, 'All buses');
  }

  async rotateCompanyQr(operatorId: string, userId: string) {
    const { operator } = await this.access.company(operatorId, userId, 'MANAGE');
    await this.prisma.qrCode.updateMany({
      where: { operatorId, kind: QrKind.COMPANY, isActive: true }, data: { isActive: false, replacedAt: new Date() },
    });
    return this.qrView(await this.newQr(operatorId, QrKind.COMPANY), operator.name, 'All buses');
  }

  // ================= dashboard =================

  async dashboard(operatorId: string, userId: string) {
    const { operator, role } = await this.access.company(operatorId, userId);
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since6Months = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const buses = await this.prisma.vehicle.findMany({
      where: { operatorId, isActive: true },
      include: { route: { select: { id: true, name: true, code: true } } },
      orderBy: { plateKey: 'asc' },
      take: MAX_BUSES_PER_COMPANY,
    });
    const ids = buses.map((b) => b.id);
    const approved = { vehicleId: { in: ids }, moderation: ModerationStatus.APPROVED };

    const [rows, archived, allTime, last30, distribution, trend, recentReviews, openIncidents, drivers, fuel30, unread] =
      await Promise.all([
        this.summarise(buses, now),
        this.prisma.vehicle.count({ where: { operatorId, isActive: false } }),
        this.prisma.rideFeedback.aggregate({
          where: approved, _count: { _all: true },
          _avg: { overall: true, cleanliness: true, driving: true, punctuality: true, staff: true },
        }),
        this.prisma.rideFeedback.aggregate({
          where: { ...approved, createdAt: { gte: since30 } }, _avg: { overall: true }, _count: { _all: true },
        }),
        this.prisma.rideFeedback.groupBy({ by: ['overall'], where: approved, _count: { _all: true } }),
        this.prisma.$queryRaw<Array<{ month: Date; average: number; reviews: number }>>`
          SELECT date_trunc('month', rf."createdAt") AS month, AVG(rf.overall)::float AS average, COUNT(*)::int AS reviews
            FROM ride_feedback rf
            JOIN vehicles v ON v.id = rf."vehicleId"
           WHERE v."operatorId" = ${operatorId} AND v."isActive" = true
             AND rf.moderation = 'APPROVED' AND rf."createdAt" >= ${since6Months}
        GROUP BY 1 ORDER BY 1`,
        this.prisma.rideFeedback.findMany({
          where: { vehicleId: { in: ids } }, orderBy: { createdAt: 'desc' }, take: 6,
          include: { vehicle: { select: { id: true, plateNo: true, label: true } } },
        }),
        this.prisma.busIncident.findMany({
          where: { vehicleId: { in: ids }, status: 'OPEN' }, orderBy: { occurredAt: 'desc' }, take: 10,
          include: { vehicle: { select: { id: true, plateNo: true, label: true } }, driver: { select: { name: true } } },
        }),
        this.prisma.driver.findMany({
          where: { operatorId, isActive: true },
          select: { id: true, name: true, role: true, licenceExpiresAt: true },
        }),
        this.prisma.fuelLog.aggregate({
          where: { vehicleId: { in: ids }, filledAt: { gte: since30 } }, _sum: { costNpr: true, litres: true }, _count: { _all: true },
        }),
        this.prisma.fleetNotification.count({ where: { operatorId, readAt: null } }),
      ]);

    const reviewCount = allTime._count._all;
    const countFor = (stars: number) => distribution.find((d) => d.overall === stars)?._count._all ?? 0;
    const satisfied = countFor(4) + countFor(5);
    const measured = rows.filter((r) => r.fuel.kmPerLitre);
    const reminders = this.reminders(rows, drivers, now);

    // Buses needing attention first, then the least-liked.
    const attention = (r: (typeof rows)[number]) =>
      (r.service.state === 'OVERDUE' ? 4 : 0) + (r.documents.expired ? 3 : 0) + (r.openIncidents ? 3 : 0)
      + (r.service.state === 'DUE_SOON' ? 1 : 0) + (r.documents.expiring ? 1 : 0);

    return {
      company: { ...companyView(operator), role },
      totals: {
        buses: buses.length,
        archived,
        byStatus: {
          ACTIVE: buses.filter((b) => b.status === BusStatus.ACTIVE).length,
          IN_MAINTENANCE: buses.filter((b) => b.status === BusStatus.IN_MAINTENANCE).length,
          OFF_ROAD: buses.filter((b) => b.status === BusStatus.OFF_ROAD).length,
        },
        seats: buses.reduce((n, b) => n + (b.seatCount ?? 0), 0),
        drivers: drivers.filter((d) => d.role === DriverRole.DRIVER).length,
        crew: drivers.length,
        busesWithoutDriver: rows.filter((r) => !r.crew.some((c) => c.role === DriverRole.DRIVER)).length,
        openIncidents: rows.reduce((n, r) => n + r.openIncidents, 0),
        serviceOverdue: rows.filter((r) => r.service.state === 'OVERDUE').length,
        serviceDueSoon: rows.filter((r) => r.service.state === 'DUE_SOON').length,
        documentsExpired: rows.reduce((n, r) => n + r.documents.expired, 0),
        documentsExpiring: rows.reduce((n, r) => n + r.documents.expiring, 0),
        unreadNotifications: unread,
      },
      satisfaction: {
        average: round1(allTime._avg.overall),
        reviews: reviewCount,
        satisfiedPercent: reviewCount ? Math.round((satisfied / reviewCount) * 100) : null,
        last30Average: round1(last30._avg.overall),
        last30Reviews: last30._count._all,
        distribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: countFor(stars) })),
        parts: {
          cleanliness: round1(allTime._avg.cleanliness), driving: round1(allTime._avg.driving),
          punctuality: round1(allTime._avg.punctuality), staff: round1(allTime._avg.staff),
        },
        trend: trend.map((t) => ({ month: t.month, average: round1(t.average), reviews: t.reviews })),
      },
      reminders: reminders.slice(0, 60),
      recentReviews: recentReviews.map(ownerReviewView),
      openIncidents: openIncidents.map((i) => ({
        id: i.id, kind: i.kind, severity: i.severity, occurredAt: i.occurredAt, location: i.location,
        description: i.description, bus: i.vehicle, driver: i.driver?.name ?? null,
      })),
      fuel: {
        last30CostNpr: fuel30._sum.costNpr ?? 0,
        last30Litres: round1(fuel30._sum.litres ?? 0),
        last30FillUps: fuel30._count._all,
        fleetKmPerLitre: measured.length ? round1(measured.reduce((n, r) => n + r.fuel.kmPerLitre, 0) / measured.length) : null,
      },
      buses: [...rows].sort((a, b) => attention(b) - attention(a) || (a.rating.average ?? 6) - (b.rating.average ?? 6)),
    };
  }

  // ================= notifications =================

  async notifications(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId);
    const [items, unread] = await Promise.all([
      this.prisma.fleetNotification.findMany({
        where: { operatorId }, orderBy: { createdAt: 'desc' }, take: 60,
        include: { vehicle: { select: { id: true, plateNo: true } } },
      }),
      this.prisma.fleetNotification.count({ where: { operatorId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markNotificationsRead(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId);
    const { count } = await this.prisma.fleetNotification.updateMany({
      where: { operatorId, readAt: null }, data: { readAt: new Date() },
    });
    return { marked: count };
  }
}

type ReviewRow = Prisma.RideFeedbackGetPayload<{ include: { vehicle: { select: { id: true; plateNo: true; label: true } } } }>;

/** What an owner sees of a review: everything the passenger wrote, nothing about who they are. */
export function ownerReviewView(r: ReviewRow) {
  return {
    id: r.id, bus: r.vehicle ? { id: r.vehicle.id, registrationNo: r.vehicle.plateNo, label: r.vehicle.label } : null,
    overall: r.overall, cleanliness: r.cleanliness, driving: r.driving, punctuality: r.punctuality, staff: r.staff,
    comment: r.comment, suggestion: r.suggestion, tripDate: r.tripDate, createdAt: r.createdAt,
    verifiedRide: !!r.qrCodeId, moderation: r.moderation, ownerReply: r.ownerReply, ownerRepliedAt: r.ownerRepliedAt,
  };
}

export type { ExpiryState };
