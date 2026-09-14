import { Body, Controller, Get, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { QrService } from './qr.service';
import { CreateQrBatchDto, ResolveScanDto } from './dto/qr.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('qr')
export class QrController {
  constructor(private qr: QrService) {}

  /**
   * Public entry point for every sticker: POST /api/v1/qr/r/{shortCode}
   * No auth. Must return content, not a login prompt.
   */
  @Public()
  @Post('r/:code')
  resolve(@Param('code') code: string, @Body() dto: ResolveScanDto, @Ip() ip: string) {
    return this.qr.resolve(code, dto.sessionId, ip);
  }

  @Public()
  @Get('offline-manifest')
  manifest(@Query('routeId') routeId?: string) {
    return this.qr.offlineManifest(routeId);
  }

  @Public()
  @Get('app-links')
  appLinks() {
    return this.qr.appLinks();
  }

  @Roles(Role.ADMIN, Role.OPERATOR_ADMIN)
  @Post('batch')
  createBatch(@Body() dto: CreateQrBatchDto) {
    return this.qr.createBatch(dto);
  }

  @Roles(Role.ADMIN, Role.OPERATOR_ADMIN)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.qr.deactivate(id);
  }

  @Roles(Role.ADMIN, Role.EDITOR, Role.OPERATOR_ADMIN)
  @Get('stats')
  stats(
    @Query('operatorId') operatorId?: string,
    @Query('routeId') routeId?: string,
    @Query('days') days?: string,
  ) {
    return this.qr.stats({ operatorId, routeId, days: days ? Number(days) : 30 });
  }
}
