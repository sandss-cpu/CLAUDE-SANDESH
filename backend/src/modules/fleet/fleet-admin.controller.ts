import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FleetAdminService } from './fleet-admin.service';
import { FleetRemindersTask } from './fleet-reminders.task';
import { AdminCompanyQueryDto, VerificationDto } from './dto/fleet.dto';

@Controller('fleet/admin')
@Roles(Role.ADMIN)
export class FleetAdminController {
  constructor(private admin: FleetAdminService, private reminders: FleetRemindersTask) {}

  @Get('stats')
  stats() { return this.admin.stats(); }

  @Get('companies')
  companies(@Query() q: AdminCompanyQueryDto) { return this.admin.companies(q); }

  @Get('companies/:id')
  company(@Param('id') id: string) { return this.admin.company(id); }

  @Patch('companies/:id/verification')
  verify(@Param('id') id: string, @Body() dto: VerificationDto, @CurrentUser('id') adminId: string) {
    return this.admin.setVerification(id, dto, adminId);
  }

  /** Runs the 06:00 reminder job now: for testing, or after importing a fleet's records. */
  @Post('reminders/run')
  runReminders() { return this.reminders.run(); }
}
