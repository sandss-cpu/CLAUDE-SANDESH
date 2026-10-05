import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OperatorMemberRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FleetAccessService } from '../fleet/fleet-access.service';

/**
 * Who may do what with a company's income, on top of company membership (which still
 * decides everything else: someone outside the company gets 404, as for any fleet record).
 *
 * - ENTER: record income on the daily sheet, import a file, attach a statement photo.
 *   Owners and managers; crew accounts never.
 * - TOTALS: reports, the dashboard, reconciliation and exports. Owners, and managers only
 *   when the owner has shared totals with them.
 * - OWN: switch income records on or off, share totals, manage the list of sources.
 *
 * Until an owner turns income records on, ENTER and TOTALS are refused for everyone.
 */
export type FinanceLevel = 'ENTER' | 'TOTALS' | 'OWN';

@Injectable()
export class FinanceAccessService {
  constructor(private prisma: PrismaService, private fleet: FleetAccessService) {}

  async company(operatorId: string, userId: string, level: FinanceLevel) {
    const { operator, role } = await this.fleet.company(operatorId, userId, level === 'OWN' ? 'OWN' : 'MANAGE');
    if (level !== 'OWN' && !operator.financeEnabled) {
      throw new ForbiddenException({ code: 'FINANCE_OFF', message: 'Income records are switched off for this company. The owner can turn them on under Company.' });
    }
    if (level === 'TOTALS' && role !== OperatorMemberRole.OWNER && !operator.managersSeeTotals) {
      throw new ForbiddenException({ code: 'TOTALS_HIDDEN', message: 'The company owner has not shared income totals with managers.' });
    }
    return { operator, role, canSeeTotals: role === OperatorMemberRole.OWNER || operator.managersSeeTotals };
  }

  async bus(vehicleId: string, userId: string, level: FinanceLevel) {
    const bus = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, operatorId: true, plateNo: true, label: true, seatCount: true, routeId: true, isActive: true },
    });
    if (!bus) throw new NotFoundException('Bus not found');
    const access = await this.company(bus.operatorId, userId, level).catch((e) => {
      throw e instanceof NotFoundException ? new NotFoundException('Bus not found') : e;
    });
    return { bus, ...access };
  }

  async entry(entryId: string, userId: string, level: FinanceLevel) {
    const entry = await this.prisma.incomeEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.deletedAt) throw new NotFoundException('Income entry not found');
    const access = await this.company(entry.operatorId, userId, level).catch((e) => {
      throw e instanceof NotFoundException ? new NotFoundException('Income entry not found') : e;
    });
    return { entry, ...access };
  }
}
