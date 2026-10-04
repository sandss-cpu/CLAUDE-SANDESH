import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FleetAdminService } from './fleet-admin.service';
import { FleetRemindersTask } from './fleet-reminders.task';
import { AdminCompanyQueryDto, StickerQueryDto, VerificationDto } from './dto/fleet.dto';
import { StickersService } from './stickers.service';
import { sendFile as send } from '../../common/utils/send-file';

@Controller('fleet/admin')
@Roles(Role.ADMIN)
export class FleetAdminController {
  constructor(
    private admin: FleetAdminService,
    private reminders: FleetRemindersTask,
    private stickers: StickersService,
  ) {}

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

  /** Batoma prints stickers for companies too: the same files the owner portal gives. */
  @Get('buses/:id/qr/sticker')
  async busSticker(@Param('id', ParseUUIDPipe) id: string, @Query() q: StickerQueryDto, @CurrentUser('id') adminId: string, @Res() res: Response) {
    send(res, await this.stickers.busFile(id, q.format ?? 'pdf', q.size ?? 'a6', adminId));
  }

  @Get('companies/:id/qr/stickers.pdf')
  async fleetStickers(@Param('id', ParseUUIDPipe) id: string, @Query() q: StickerQueryDto, @CurrentUser('id') adminId: string, @Res() res: Response) {
    send(res, await this.stickers.fleetSheet(id, q.size ?? 'a6', adminId));
  }

  /** Runs the 06:00 reminder job now: for testing, or after importing a fleet's records. */
  @Post('reminders/run')
  runReminders() { return this.reminders.run(); }
}
