import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BusStatus, IncidentSeverity, IncidentStatus, MaintenanceKind, Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FleetAccessService, parseDate } from './fleet-access.service';
import { busView } from './fleet.service';
import {
  DocumentDto, DriverDto, FuelDto, IncidentDto, MaintenanceDto, ResolveIncidentDto,
} from './dto/fleet.dto';
import { DAY_MS, expiry, mileage } from './fleet.util';

const INCIDENT_LABEL: Record<string, string> = {
  BREAKDOWN: 'breakdown', ACCIDENT: 'accident', FLAT_TYRE: 'flat tyre', ENGINE: 'engine trouble',
  BRAKES: 'brake problem', ELECTRICAL: 'electrical fault', OTHER: 'incident',
};

/**
 * The bus's working history: service and repairs, breakdowns, documents, crew
 * and fuel. Writes need MANAGE; every lookup goes through FleetAccessService.
 */
@Injectable()
export class FleetRecordsService {
  constructor(private prisma: PrismaService, private access: FleetAccessService) {}

  /** Readings only move the bus's odometer forwards; a typo on an old record can't wind it back. */
  private bumpOdometer(tx: Prisma.TransactionClient, vehicleId: string, current: number, reading?: number | null) {
    if (reading == null || reading <= current) return Promise.resolve();
    return tx.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: reading } }).then(() => undefined);
  }

  // ================= maintenance =================

  async maintenance(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    return this.prisma.maintenanceRecord.findMany({
      where: { vehicleId: busId }, orderBy: [{ servicedAt: 'desc' }, { createdAt: 'desc' }], take: 500,
    });
  }

  private maintenanceData(dto: MaintenanceDto) {
    this.access.assertMedia(...(dto.photos ?? []));
    const servicedAt = parseDate(dto.servicedAt, 'The service date');
    const nextDueDate = parseDate(dto.nextDueDate, 'The next service date', -1);
    if (nextDueDate && nextDueDate <= servicedAt) {
      throw new BadRequestException('The next service date must be after this service.');
    }
    if (dto.nextDueKm != null && dto.nextDueKm <= dto.odometerKm) {
      throw new BadRequestException('The next service reading must be higher than this one.');
    }
    return {
      kind: dto.kind, servicedAt, odometerKm: dto.odometerKm, title: dto.title, note: dto.note ?? null,
      workshop: dto.workshop ?? null, costNpr: dto.costNpr ?? null,
      partsReplaced: (dto.partsReplaced ?? []).map((p) => p.trim()).filter(Boolean),
      photos: dto.photos ?? [], nextDueDate, nextDueKm: dto.nextDueKm ?? null,
    };
  }

  async addMaintenance(busId: string, dto: MaintenanceDto, userId: string) {
    const { bus } = await this.access.bus(busId, userId, 'MANAGE');
    const data = this.maintenanceData(dto);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.maintenanceRecord.create({ data: { ...data, vehicleId: busId, createdById: userId } });
      await this.bumpOdometer(tx, busId, bus.odometerKm, dto.odometerKm);
      // A completed service answers its reminders; don't leave them nagging in the bell.
      if (dto.kind === MaintenanceKind.ROUTINE_SERVICE) {
        await tx.fleetNotification.updateMany({
          where: { vehicleId: busId, kind: { in: ['SERVICE_DUE', 'SERVICE_OVERDUE'] }, readAt: null },
          data: { readAt: new Date() },
        });
      }
      return record;
    });
  }

  private async recordForMember(id: string, userId: string) {
    const record = await this.prisma.maintenanceRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Record not found');
    const { bus } = await this.access.bus(record.vehicleId, userId, 'MANAGE');
    return { record, bus };
  }

  async updateMaintenance(id: string, dto: MaintenanceDto, userId: string) {
    const { bus } = await this.recordForMember(id, userId);
    const data = this.maintenanceData(dto);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.maintenanceRecord.update({ where: { id }, data });
      await this.bumpOdometer(tx, bus.id, bus.odometerKm, dto.odometerKm);
      return record;
    });
  }

  async deleteMaintenance(id: string, userId: string) {
    await this.recordForMember(id, userId);
    await this.prisma.maintenanceRecord.delete({ where: { id } });
    return { deleted: true };
  }

  // ================= breakdowns =================

  async incidents(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    return this.prisma.busIncident.findMany({
      where: { vehicleId: busId }, orderBy: [{ status: 'asc' }, { occurredAt: 'desc' }], take: 300,
      include: { driver: { select: { id: true, name: true } } },
    });
  }

  async reportIncident(busId: string, dto: IncidentDto, userId: string) {
    const { bus } = await this.access.bus(busId, userId, 'MANAGE');
    this.access.assertMedia(...(dto.photos ?? []));
    const occurredAt = parseDate(dto.occurredAt, 'The time it happened', 0.05);
    if (dto.driverId) {
      const driver = await this.prisma.driver.findFirst({ where: { id: dto.driverId, operatorId: bus.operatorId } });
      if (!driver) throw new BadRequestException('Choose a driver from your crew list.');
    }

    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.busIncident.create({
        data: {
          vehicleId: busId, kind: dto.kind, severity: dto.severity, occurredAt, location: dto.location,
          odometerKm: dto.odometerKm, description: dto.description, photos: dto.photos ?? [],
          driverId: dto.driverId, reportedById: userId,
        },
        include: { driver: { select: { id: true, name: true } } },
      });
      await this.bumpOdometer(tx, busId, bus.odometerKm, dto.odometerKm);
      // A serious breakdown takes the bus off the road until someone marks it fixed.
      if (dto.severity !== IncidentSeverity.MINOR && bus.status === BusStatus.ACTIVE) {
        await tx.vehicle.update({ where: { id: busId }, data: { status: BusStatus.IN_MAINTENANCE } });
      }
      await tx.fleetNotification.create({
        data: {
          operatorId: bus.operatorId, vehicleId: busId, kind: 'INCIDENT',
          title: `${dto.severity === IncidentSeverity.CRITICAL ? 'Critical ' : ''}${INCIDENT_LABEL[dto.kind]} reported: ${bus.plateNo}`,
          body: dto.description.slice(0, 200) + (dto.location ? ` (${dto.location})` : ''),
          dedupeKey: `incident:${incident.id}`,
        },
      });
      return incident;
    });
  }

  async resolveIncident(id: string, dto: ResolveIncidentDto, userId: string) {
    const incident = await this.prisma.busIncident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found');
    const { bus } = await this.access.bus(incident.vehicleId, userId, 'MANAGE');
    if (incident.status === IncidentStatus.RESOLVED) throw new BadRequestException('This is already marked as fixed.');

    return this.prisma.$transaction(async (tx) => {
      const resolved = await tx.busIncident.update({
        where: { id },
        data: {
          status: IncidentStatus.RESOLVED, resolvedAt: new Date(),
          resolutionNote: dto.resolutionNote, repairCostNpr: dto.repairCostNpr,
        },
        include: { driver: { select: { id: true, name: true } } },
      });
      if (dto.addToServiceHistory) {
        await tx.maintenanceRecord.create({
          data: {
            vehicleId: bus.id, kind: MaintenanceKind.REPAIR, servicedAt: new Date(),
            odometerKm: incident.odometerKm ?? bus.odometerKm,
            title: `Repair after ${INCIDENT_LABEL[incident.kind]}`,
            note: `${dto.resolutionNote}\n\nReported: ${incident.description}`, costNpr: dto.repairCostNpr,
            photos: incident.photos, createdById: userId,
          },
        });
      }
      const stillOpen = await tx.busIncident.count({ where: { vehicleId: bus.id, status: IncidentStatus.OPEN } });
      if (!stillOpen && bus.status === BusStatus.IN_MAINTENANCE) {
        await tx.vehicle.update({ where: { id: bus.id }, data: { status: BusStatus.ACTIVE } });
      }
      return resolved;
    });
  }

  // ================= documents =================

  async documents(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    const docs = await this.prisma.busDocument.findMany({
      where: { vehicleId: busId }, orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return docs.map((d) => ({ ...d, ...expiry(d.expiresAt) }));
  }

  private documentData(dto: DocumentDto) {
    this.access.assertMedia(dto.photoUrl);
    const issuedAt = parseDate(dto.issuedAt, 'The issue date');
    const expiresAt = parseDate(dto.expiresAt, 'The expiry date', -1);
    if (issuedAt && expiresAt && expiresAt <= issuedAt) {
      throw new BadRequestException('The expiry date must be after the issue date.');
    }
    return {
      type: dto.type, number: dto.number ?? null, issuer: dto.issuer ?? null, issuedAt, expiresAt,
      photoUrl: dto.photoUrl ?? null, note: dto.note ?? null,
    };
  }

  /** Renewing a document closes the reminders raised for the old expiry date. */
  private clearDocumentReminders(tx: Prisma.TransactionClient, vehicleId: string, type: string) {
    return tx.fleetNotification.updateMany({
      where: { vehicleId, readAt: null, dedupeKey: { startsWith: `doc:${vehicleId}:${type}:` } },
      data: { readAt: new Date() },
    });
  }

  async addDocument(busId: string, dto: DocumentDto, userId: string) {
    await this.access.bus(busId, userId, 'MANAGE');
    const data = this.documentData(dto);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.busDocument.create({ data: { ...data, vehicleId: busId } });
      await this.clearDocumentReminders(tx, busId, dto.type);
      return { ...doc, ...expiry(doc.expiresAt) };
    });
  }

  private async documentForMember(id: string, userId: string) {
    const doc = await this.prisma.busDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.access.bus(doc.vehicleId, userId, 'MANAGE');
    return doc;
  }

  async updateDocument(id: string, dto: DocumentDto, userId: string) {
    const existing = await this.documentForMember(id, userId);
    const data = this.documentData(dto);
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.busDocument.update({ where: { id }, data });
      await this.clearDocumentReminders(tx, existing.vehicleId, dto.type);
      return { ...doc, ...expiry(doc.expiresAt) };
    });
  }

  async deleteDocument(id: string, userId: string) {
    await this.documentForMember(id, userId);
    await this.prisma.busDocument.delete({ where: { id } });
    return { deleted: true };
  }

  // ================= crew =================

  async drivers(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId);
    const drivers = await this.prisma.driver.findMany({
      where: { operatorId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        assignments: {
          where: { endedAt: null },
          include: { vehicle: { select: { id: true, plateNo: true, label: true } } },
        },
        _count: { select: { incidents: true } },
      },
    });
    return drivers.map(({ assignments, _count, ...d }) => ({
      ...d,
      licence: expiry(d.licenceExpiresAt),
      buses: assignments.map((a) => ({ ...a.vehicle, registrationNo: a.vehicle.plateNo, since: a.startedAt })),
      incidents: _count.incidents,
    }));
  }

  private driverData(dto: DriverDto) {
    this.access.assertMedia(dto.photoUrl);
    return {
      name: dto.name, phone: dto.phone, role: dto.role, licenceNumber: dto.licenceNumber ?? null,
      licenceExpiresAt: parseDate(dto.licenceExpiresAt, 'The licence expiry date', -1),
      photoUrl: dto.photoUrl ?? null, note: dto.note ?? null,
    };
  }

  async addDriver(operatorId: string, dto: DriverDto, userId: string) {
    await this.access.company(operatorId, userId, 'MANAGE');
    const count = await this.prisma.driver.count({ where: { operatorId } });
    if (count >= 5000) throw new BadRequestException('This company has reached the crew limit. Contact Bato.');
    return this.prisma.driver.create({ data: { ...this.driverData(dto), operatorId } });
  }

  async updateDriver(id: string, dto: DriverDto, userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver) throw new NotFoundException('Crew member not found');
    await this.access.company(driver.operatorId, userId, 'MANAGE');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver.update({
        where: { id }, data: { ...this.driverData(dto), ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}) },
      });
      if (dto.isActive === false) {
        await tx.driverAssignment.updateMany({ where: { driverId: id, endedAt: null }, data: { endedAt: new Date() } });
      }
      return updated;
    });
  }

  /**
   * Puts a crew member on a bus. They leave any other bus, and whoever held the
   * same job on this bus steps off, so the history always shows one driver per bus.
   */
  async assign(busId: string, driverId: string, userId: string) {
    const { bus } = await this.access.bus(busId, userId, 'MANAGE');
    const driver = await this.prisma.driver.findFirst({ where: { id: driverId, operatorId: bus.operatorId, isActive: true } });
    if (!driver) throw new BadRequestException('Choose an active crew member from your company.');
    if (!bus.isActive) throw new BadRequestException('Restore this bus before assigning crew.');

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const sameJob = await tx.driverAssignment.findMany({
        where: { vehicleId: busId, endedAt: null, driver: { role: driver.role } }, select: { id: true },
      });
      await tx.driverAssignment.updateMany({
        where: { OR: [{ driverId, endedAt: null }, { id: { in: sameJob.map((a) => a.id) } }] },
        data: { endedAt: now },
      });
      await tx.driverAssignment.create({ data: { driverId, vehicleId: busId, startedAt: now } });
    });
    return this.crew(busId, userId);
  }

  async unassign(busId: string, driverId: string, userId: string) {
    await this.access.bus(busId, userId, 'MANAGE');
    await this.prisma.driverAssignment.updateMany({
      where: { vehicleId: busId, driverId, endedAt: null }, data: { endedAt: new Date() },
    });
    return this.crew(busId, userId);
  }

  async crew(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    const rows = await this.prisma.driverAssignment.findMany({
      where: { vehicleId: busId }, orderBy: [{ startedAt: 'desc' }], take: 100,
      include: { driver: { select: { id: true, name: true, phone: true, role: true, licenceNumber: true, licenceExpiresAt: true } } },
    });
    return {
      current: rows.filter((r) => !r.endedAt).map((r) => ({ ...r.driver, since: r.startedAt, licence: expiry(r.driver.licenceExpiresAt) })),
      history: rows.map((r) => ({ id: r.id, driver: r.driver, startedAt: r.startedAt, endedAt: r.endedAt })),
    };
  }

  // ================= fuel =================

  async fuel(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    const logs = await this.prisma.fuelLog.findMany({
      where: { vehicleId: busId, filledAt: { gte: new Date(Date.now() - 400 * DAY_MS) } },
      orderBy: [{ filledAt: 'desc' }, { odometerKm: 'desc' }],
    });
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const inMonth = logs.filter((l) => l.filledAt >= start && l.filledAt < end);
      return {
        month: start,
        costNpr: inMonth.reduce((n, l) => n + l.costNpr, 0),
        litres: Math.round(inMonth.reduce((n, l) => n + l.litres, 0) * 10) / 10,
      };
    });
    return { logs: logs.slice(0, 200), economy: mileage(logs), months };
  }

  async addFuel(busId: string, dto: FuelDto, userId: string) {
    const { bus } = await this.access.bus(busId, userId, 'MANAGE');
    const filledAt = parseDate(dto.filledAt, 'The fill-up date');
    const later = await this.prisma.fuelLog.findFirst({
      where: { vehicleId: busId, filledAt: { lte: filledAt }, odometerKm: { gt: dto.odometerKm } },
      orderBy: { odometerKm: 'desc' },
    });
    if (later) {
      throw new BadRequestException(
        `The kilometre reading is lower than an earlier fill-up (${later.odometerKm.toLocaleString('en')} km). Check the reading or the date.`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const log = await tx.fuelLog.create({
        data: {
          vehicleId: busId, filledAt, odometerKm: dto.odometerKm, litres: dto.litres, costNpr: dto.costNpr,
          fullTank: dto.fullTank ?? true, station: dto.station, note: dto.note,
        },
      });
      await this.bumpOdometer(tx, busId, bus.odometerKm, dto.odometerKm);
      return log;
    });
  }

  async deleteFuel(id: string, userId: string) {
    const log = await this.prisma.fuelLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('Fill-up not found');
    await this.access.bus(log.vehicleId, userId, 'MANAGE');
    await this.prisma.fuelLog.delete({ where: { id } });
    return { deleted: true };
  }

  // ================= export =================

  /** The complete record for one bus, for the owner portal to turn into CSV or a printable report. */
  async history(busId: string, userId: string) {
    await this.access.bus(busId, userId);
    const bus = await this.prisma.vehicle.findUnique({
      where: { id: busId },
      include: {
        route: { select: { id: true, name: true, code: true } },
        operator: { select: { name: true, registrationNo: true, contactPhone: true, address: true } },
      },
    });
    const [maintenance, incidents, documents, fuel, crew] = await Promise.all([
      this.prisma.maintenanceRecord.findMany({ where: { vehicleId: busId }, orderBy: { servicedAt: 'asc' } }),
      this.prisma.busIncident.findMany({
        where: { vehicleId: busId }, orderBy: { occurredAt: 'asc' }, include: { driver: { select: { name: true } } },
      }),
      this.prisma.busDocument.findMany({ where: { vehicleId: busId }, orderBy: { expiresAt: 'asc' } }),
      this.prisma.fuelLog.findMany({ where: { vehicleId: busId }, orderBy: { filledAt: 'asc' } }),
      this.prisma.driverAssignment.findMany({
        where: { vehicleId: busId }, orderBy: { startedAt: 'asc' },
        include: { driver: { select: { name: true, role: true, licenceNumber: true } } },
      }),
    ]);
    return {
      generatedAt: new Date(),
      company: bus.operator,
      bus: busView(bus),
      maintenance,
      incidents,
      documents: documents.map((d) => ({ ...d, ...expiry(d.expiresAt) })),
      fuel: { logs: fuel, economy: mileage(fuel) },
      crew: crew.map((a) => ({ ...a.driver, startedAt: a.startedAt, endedAt: a.endedAt })),
    };
  }
}
