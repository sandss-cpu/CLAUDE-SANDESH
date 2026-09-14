import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OperatorsService } from './operators.service';
import {
  CreateOperatorDto, CreateRouteDto, CreateVehicleDto, LostItemDto, RideFeedbackDto,
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

  /** Anonymous, no account required — that is why the data is honest. */
  @Public() @Post('feedback')
  feedback(@Body() dto: RideFeedbackDto) { return this.operators.submitFeedback(dto); }

  @Public() @Post('lost-items')
  lostItem(@Body() dto: LostItemDto) { return this.operators.reportLostItem(dto); }

  @Get(':id/dashboard')
  dashboard(@Param('id') id: string, @CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.operators.dashboard(id, u.id, u.role as Role, Number(days ?? 30));
  }

  @Roles(Role.ADMIN) @Post()
  create(@Body() dto: CreateOperatorDto) { return this.operators.createOperator(dto); }

  @Roles(Role.ADMIN, Role.OPERATOR_ADMIN) @Post('vehicles')
  vehicle(@Body() dto: CreateVehicleDto) { return this.operators.createVehicle(dto); }

  @Roles(Role.ADMIN) @Post('routes')
  createRoute(@Body() dto: CreateRouteDto) { return this.operators.createRoute(dto); }
}
