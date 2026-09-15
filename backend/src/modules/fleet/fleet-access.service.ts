import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OperatorMemberRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';

/** VIEW: any member. MANAGE: day-to-day records. OWN: company details, team and deleting buses. */
export type AccessLevel = 'VIEW' | 'MANAGE' | 'OWN';

/**
 * Company membership is the only thing that grants access to fleet records;
 * User.role plays no part, so even a platform admin sees a company's drivers
 * and documents only through the admin screens. Someone outside the company
 * gets "not found" rather than "forbidden", so ids can't be probed.
 */
@Injectable()
export class FleetAccessService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  async company(operatorId: string, userId: string, level: AccessLevel = 'VIEW') {
    const link = await this.prisma.operatorAdmin.findUnique({
      where: { operatorId_userId: { operatorId, userId } },
      include: { operator: true },
    });
    if (!link) throw new NotFoundException('Company not found');
    this.require(link.role, level);
    return { operator: link.operator, role: link.role };
  }

  async bus(vehicleId: string, userId: string, level: AccessLevel = 'VIEW') {
    const bus = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!bus) throw new NotFoundException('Bus not found');
    const link = await this.prisma.operatorAdmin.findUnique({
      where: { operatorId_userId: { operatorId: bus.operatorId, userId } },
      select: { role: true },
    });
    if (!link) throw new NotFoundException('Bus not found');
    this.require(link.role, level);
    return { bus, role: link.role };
  }

  private require(role: OperatorMemberRole, level: AccessLevel) {
    if (level === 'OWN' && role !== OperatorMemberRole.OWNER) {
      throw new ForbiddenException('Only a company owner can do this.');
    }
  }

  /** Photos of buses, parts and documents must come from /media/upload, like every other image on Bato. */
  assertMedia(...urls: Array<string | null | undefined>) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if (urls.filter(Boolean).some((u) => !isOwnMediaUrl(u, base))) {
      throw new BadRequestException('Photos must be uploaded through Bato.');
    }
  }

  webUrl(path: string) {
    const base = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    return `${base}/${path.replace(/^\//, '')}`;
  }
}

/** Parses a date field, refusing dates further in the future than `futureDays`. */
export function parseDate(value: string | undefined | null, label: string, futureDays = 1): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} is not a valid date.`);
  if (futureDays >= 0 && d.getTime() > Date.now() + futureDays * 86_400_000) {
    throw new BadRequestException(`${label} can't be in the future.`);
  }
  return d;
}
