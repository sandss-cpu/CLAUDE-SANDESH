import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OperatorsService } from './operators.service';
import { Throttle } from '@nestjs/throttler';
import {
  CreateOperatorDto, CreateRouteDto, CreateVehicleDto, LostItemDto,
} from './dto/operator.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('operators')
export class OperatorsController {
  constructor(private operators: OperatorsService) {}

  @Public() @Get('routes')
  routes() { return this.operators.listRoutes(); }

  @Public() @Get('routes/:id')
  routeInfo(@Param('id') id: string) { return this.operators.routeInfo(id); }

  // Passenger ratings moved to POST /buses/:id/reviews, which needs a QR scan or a
  // confirmed account. The old anonymous route accepted any vehicleId from anyone.

  @Public() @Throttle({ default: { limit: 5, ttl: 900_000 } }) @Post('lost-items')
  lostItem(@Body() dto: LostItemDto) { return this.operators.reportLostItem(dto); }

  @Get(':id/dashboard')
  dashboard(@Param('id') id: string, @CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.operators.dashboard(id, u.id, u.role as Role, Number(days ?? 30));
  }

  @Roles(Role.ADMIN) @Post()
  create(@Body() dto: CreateOperatorDto) { return this.operators.createOperator(dto); }

  /** Admin only: it takes any operatorId. Owners register buses through /fleet. */
  @Roles(Role.ADMIN) @Post('vehicles')
  vehicle(@Body() dto: CreateVehicleDto) { return this.operators.createVehicle(dto); }

  @Roles(Role.ADMIN) @Post('routes')
  createRoute(@Body() dto: CreateRouteDto) { return this.operators.createRoute(dto); }
}
