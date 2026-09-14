import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { slugify } from '../../common/utils/slug.util';
import {
  CreateOperatorDto, CreateRouteDto, CreateVehicleDto, LostItemDto, RideFeedbackDto,
} from './dto/operator.dto';

@Injectable()
export class OperatorsService {
  constructor(private prisma: PrismaService) {}

  listRoutes() {
    return this.prisma.route.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true, code: true, name: true, nameNe: true, startPlace: true,
        endPlace: true, distanceKm: true, typicalHours: true,
      },
    });
  }

  createRoute(dto: CreateRouteDto) {
    return this.prisma.route.create({ data: dto });
  }

  createOperator(dto: CreateOperatorDto) {
    return this.prisma.operator.create({
      data: { ...dto, slug: slugify(dto.name) },
    });
  }

  createVehicle(dto: CreateVehicleDto) {
    return this.prisma.vehicle.create({ data: dto });
  }

  /**
   * Passenger feedback. Anonymous by design — a passenger will not rate the
   * driver honestly if their identity is attached, and honest data is the
   * whole reason the operator agrees to seat-back placement.
   */
  submitFeedback(dto: RideFeedbackDto) {
    return this.prisma.rideFeedback.create({ data: dto });
  }

  reportLostItem(dto: LostItemDto) {
    return this.prisma.lostItem.create({ data: dto });
  }

  private async assertOperatorAccess(operatorId: string, userId: string, role: Role) {
    if (role === Role.ADMIN) return;
    const link = await this.prisma.operatorAdmin.findUnique({
      where: { operatorId_userId: { operatorId, userId } },
    });
    if (!link) throw new ForbiddenException('You do not manage this operator');
  }

  /** Feedback trends by vehicle and route — the operator dashboard. */
  async dashboard(operatorId: string, userId: string, role: Role, days = 30) {
    await this.assertOperatorAccess(operatorId, userId, role);
    const since = new Date(Date.now() - days * 86_400_000);

    const operator = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      include: { vehicles: { select: { id: true, plateNo: true, label: true } } },
    });
    if (!operator) throw new NotFoundException('Operator not found');

    const vehicleIds = operator.vehicles.map((v) => v.id);

    const [overall, byVehicle, scans, recentComments, lostItems] = await Promise.all([
      this.prisma.rideFeedback.aggregate({
        where: { vehicleId: { in: vehicleIds }, createdAt: { gte: since } },
        _avg: { cleanliness: true, driving: true, punctuality: true, staff: true },
        _count: true,
      }),
      this.prisma.rideFeedback.groupBy({
        by: ['vehicleId'],
        where: { vehicleId: { in: vehicleIds }, createdAt: { gte: since } },
        _avg: { cleanliness: true, driving: true, punctuality: true, staff: true },
        _count: { vehicleId: true },
      }),
      this.prisma.scanEvent.count({
        where: { qrCode: { operatorId }, scannedAt: { gte: since } },
      }),
      this.prisma.rideFeedback.findMany({
        where: {
          vehicleId: { in: vehicleIds },
          createdAt: { gte: since },
          comment: { not: null },
        },
        select: { comment: true, createdAt: true, vehicleId: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.lostItem.findMany({
        where: { vehicleId: { in: vehicleIds }, status: 'OPEN' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const plateOf = (id: string) =>
      operator.vehicles.find((v) => v.id === id)?.plateNo ?? 'Unknown';

    const round = (n: number | null) => (n == null ? null : +n.toFixed(2));

    return {
      operator: { id: operator.id, name: operator.name, slug: operator.slug },
      periodDays: days,
      scans,
      responses: overall._count,
      averages: {
        cleanliness: round(overall._avg.cleanliness),
        driving: round(overall._avg.driving),
        punctuality: round(overall._avg.punctuality),
        staff: round(overall._avg.staff),
      },
      byVehicle: byVehicle
        .map((v) => ({
          vehicleId: v.vehicleId,
          plateNo: plateOf(v.vehicleId),
          responses: v._count.vehicleId,
          cleanliness: round(v._avg.cleanliness),
          driving: round(v._avg.driving),
          punctuality: round(v._avg.punctuality),
          staff: round(v._avg.staff),
        }))
        .sort((a, b) => (a.driving ?? 5) - (b.driving ?? 5)),
      recentComments: recentComments.map((c) => ({
        comment: c.comment, plateNo: plateOf(c.vehicleId), at: c.createdAt,
      })),
      openLostItems: lostItems,
    };
  }

  /** Public route page: stops, articles and the corridor's essentials. */
  async routeInfo(routeId: string) {
    const route = await this.prisma.route.findUnique({ where: { id: routeId } });
    if (!route) throw new NotFoundException('Route not found');

    const [articles, businesses, feedback] = await Promise.all([
      this.prisma.article.findMany({
        where: { status: 'PUBLISHED', routeLinks: { some: { routeId } } },
        select: {
          id: true, slug: true, title: true, coverImageUrl: true, readMinutes: true,
        },
        take: 20,
      }),
      this.prisma.business.count({ where: { routeTargets: { some: { routeId } } } }),
      this.prisma.rideFeedback.aggregate({
        where: { routeId },
        _avg: { cleanliness: true, driving: true, punctuality: true },
        _count: true,
      }),
    ]);

    return {
      route,
      articles,
      businessCount: businesses,
      passengerRatings: {
        responses: feedback._count,
        cleanliness: feedback._avg.cleanliness,
        driving: feedback._avg.driving,
        punctuality: feedback._avg.punctuality,
      },
    };
  }
}
