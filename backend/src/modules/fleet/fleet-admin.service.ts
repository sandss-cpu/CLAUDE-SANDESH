import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ModerationAct, ModerationStatus, OperatorVerification, Prisma, TargetType,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { FleetAccessService } from './fleet-access.service';
import { companyView } from './fleet.service';
import { AdminCompanyQueryDto, VerificationDto } from './dto/fleet.dto';
import { round1 } from './fleet.util';

const ACT_FOR: Record<OperatorVerification, ModerationAct> = {
  VERIFIED: ModerationAct.APPROVE,
  REJECTED: ModerationAct.REJECT,
  SUSPENDED: ModerationAct.PAUSE,
  PENDING: ModerationAct.UPDATE,
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Bato's side of the bus portal: who is verified, and how many buses are on the platform. */
@Injectable()
export class FleetAdminService {
  private readonly logger = new Logger(FleetAdminService.name);

  constructor(private prisma: PrismaService, private mail: MailService, private access: FleetAccessService) {}

  async stats() {
    const [byStatus, activeBuses, archivedBuses, reviews, openIncidents, drivers, scans30] = await Promise.all([
      this.prisma.operator.groupBy({ by: ['verification'], _count: { _all: true } }),
      this.prisma.vehicle.count({ where: { isActive: true } }),
      this.prisma.vehicle.count({ where: { isActive: false } }),
      this.prisma.rideFeedback.aggregate({
        where: { moderation: ModerationStatus.APPROVED, vehicleId: { not: null } }, _avg: { overall: true }, _count: { _all: true },
      }),
      this.prisma.busIncident.count({ where: { status: 'OPEN' } }),
      this.prisma.driver.count({ where: { isActive: true } }),
      this.prisma.scanEvent.count({
        where: { scannedAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, qrCode: { kind: { in: ['BUS', 'COMPANY'] } } },
      }),
    ]);
    const count = (s: OperatorVerification) => byStatus.find((b) => b.verification === s)?._count._all ?? 0;
    return {
      companies: {
        total: byStatus.reduce((n, b) => n + b._count._all, 0),
        verified: count(OperatorVerification.VERIFIED), pending: count(OperatorVerification.PENDING),
        rejected: count(OperatorVerification.REJECTED), suspended: count(OperatorVerification.SUSPENDED),
      },
      buses: { registered: activeBuses + archivedBuses, active: activeBuses, archived: archivedBuses },
      reviews: { total: reviews._count._all, average: round1(reviews._avg.overall) },
      openIncidents, activeCrew: drivers, profileScansLast30Days: scans30,
    };
  }

  async companies(q: AdminCompanyQueryDto) {
    const text = q.q?.trim();
    const where: Prisma.OperatorWhereInput = {
      ...(q.status ? { verification: q.status } : {}),
      ...(text ? {
        OR: [
          { name: { contains: text, mode: 'insensitive' } },
          { registrationNo: { contains: text, mode: 'insensitive' } },
          { contactPhone: { contains: text } },
          { vehicles: { some: { plateKey: { contains: text.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '') } } } },
        ],
      } : {}),
    };
    const operators = await this.prisma.operator.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 300,
      include: {
        _count: { select: { vehicles: { where: { isActive: true } }, drivers: { where: { isActive: true } } } },
        admins: {
          where: { role: 'OWNER' }, take: 3,
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    const ratings = operators.length ? await this.prisma.$queryRaw<Array<{ operatorId: string; average: number; reviews: number }>>`
      SELECT v."operatorId" AS "operatorId", AVG(rf.overall)::float AS average, COUNT(*)::int AS reviews
        FROM ride_feedback rf JOIN vehicles v ON v.id = rf."vehicleId"
       WHERE rf.moderation = 'APPROVED' AND v."operatorId" IN (${Prisma.join(operators.map((o) => o.id))})
    GROUP BY v."operatorId"` : [];

    return operators.map((o) => {
      const r = ratings.find((x) => x.operatorId === o.id);
      return {
        ...companyView(o),
        buses: o._count.vehicles, crew: o._count.drivers,
        owners: o.admins.map((a) => a.user),
        rating: { average: round1(r?.average), reviews: r?.reviews ?? 0 },
      };
    });
  }

  async company(id: string) {
    const operator = await this.prisma.operator.findUnique({
      where: { id },
      include: {
        admins: { include: { user: { select: { id: true, name: true, email: true, phone: true } } }, orderBy: { createdAt: 'asc' } },
        vehicles: {
          orderBy: { plateKey: 'asc' }, take: 500,
          select: { id: true, plateNo: true, label: true, status: true, isActive: true, busType: true, seatCount: true, createdAt: true },
        },
      },
    });
    if (!operator) throw new NotFoundException('Company not found');
    const history = await this.prisma.moderationEntry.findMany({
      where: { targetType: TargetType.OPERATOR, targetId: id }, orderBy: { createdAt: 'desc' }, take: 20,
      include: { moderator: { select: { name: true } } },
    });
    return {
      ...companyView(operator),
      members: operator.admins.map((a) => ({ ...a.user, role: a.role, since: a.createdAt })),
      buses: operator.vehicles.map(({ plateNo, ...v }) => ({ ...v, registrationNo: plateNo })),
      history,
    };
  }

  async setVerification(id: string, dto: VerificationDto, adminId: string) {
    const operator = await this.prisma.operator.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!operator) throw new NotFoundException('Company not found');
    if ((dto.status === OperatorVerification.REJECTED || dto.status === OperatorVerification.SUSPENDED) && !dto.note) {
      throw new BadRequestException('Give the company a reason. They will see it in their portal.');
    }

    const message = {
      VERIFIED: { title: 'Your company is verified', body: 'Your buses are now public on Bato, and passengers can scan their QR codes to leave reviews.' },
      REJECTED: { title: 'Verification was not approved', body: 'Update your company details and they will be checked again.' },
      SUSPENDED: { title: 'Your company is suspended', body: 'Your buses are hidden from passengers and their QR codes are paused.' },
      PENDING: { title: 'Bato is checking your company again', body: 'Your buses stay hidden from passengers until the check is finished.' },
    }[dto.status];
    const body = dto.note ? `${message.body} Note from Bato: ${dto.note}` : message.body;

    await this.prisma.$transaction([
      this.prisma.operator.update({
        where: { id },
        data: {
          verification: dto.status,
          verifiedAt: dto.status === OperatorVerification.VERIFIED ? new Date() : null,
          verificationNote: dto.note ?? null,
        },
      }),
      this.prisma.moderationEntry.create({
        data: { moderatorId: adminId, targetType: TargetType.OPERATOR, targetId: id, action: ACT_FOR[dto.status], note: dto.note },
      }),
      this.prisma.fleetNotification.create({
        data: {
          operatorId: id, kind: 'VERIFICATION', title: message.title, body,
          dedupeKey: `verification:${id}:${dto.status}:${Date.now()}`,
        },
      }),
    ]);

    const recipients = await this.prisma.operatorAdmin.findMany({
      where: { operatorId: id, user: { emailVerifiedAt: { not: null } } },
      select: { user: { select: { email: true, name: true } } },
    });
    for (const { user } of recipients) {
      const content = this.mail.linkEmail({
        heading: escapeHtml(message.title),
        intro: `Namaste ${escapeHtml(user.name)}, this is about ${escapeHtml(operator.name)}. ${escapeHtml(body)}`,
        cta: 'Open the owner portal', url: this.access.webUrl('owner.html'),
        footer: 'You receive this because you manage this company on Bato.',
      });
      await this.mail.send(user.email, `${message.title} — Bato`, content.text, content.html)
        .catch((e) => this.logger.warn(`Verification email failed: ${(e as Error).message}`));
    }
    return this.company(id);
  }
}
