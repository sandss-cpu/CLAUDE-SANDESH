import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('admin')
@Roles(Role.ADMIN)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('overview')
  overview(@Query('days') days?: string) {
    return this.admin.overview(Number(days ?? 30));
  }

  @Get('subscriptions')
  subscriptions() { return this.admin.subscriptions(); }

  @Get('audit-log')
  audit(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.admin.auditLog(Number(skip ?? 0), Number(take ?? 100));
  }
}
