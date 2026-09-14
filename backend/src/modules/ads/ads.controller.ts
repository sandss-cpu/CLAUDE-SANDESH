import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { AdsService } from './ads.service';
import {
  AdminAdQueryDto, AdSlotQueryDto, ImpressionsDto, SaveAdDto, SetAdActiveDto,
} from './dto/ads.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('ads')
export class AdsController {
  constructor(private ads: AdsService) {}

  // ---- admin (literal "admin" routes are declared before ":id" ones) ----

  @Roles(Role.ADMIN) @Get('admin')
  adminList(@Query() q: AdminAdQueryDto) { return this.ads.adminList(q.status); }

  @Roles(Role.ADMIN) @Post('admin')
  create(@Body() dto: SaveAdDto, @CurrentUser('id') actorId: string) {
    return this.ads.create(dto, actorId);
  }

  @Roles(Role.ADMIN) @Patch('admin/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAdDto, @CurrentUser('id') actorId: string,
  ) {
    return this.ads.update(id, dto, actorId);
  }

  @Roles(Role.ADMIN) @Patch('admin/:id/active')
  setActive(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAdActiveDto, @CurrentUser('id') actorId: string,
  ) {
    return this.ads.setActive(id, dto.isActive, actorId);
  }

  @Roles(Role.ADMIN) @Delete('admin/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.ads.remove(id, actorId);
  }

  // ---- public ----

  /** The ads to show in one slot right now. */
  @Public() @Get()
  slot(@Query() q: AdSlotQueryDto) { return this.ads.slot(q.placement, q.limit ?? 1); }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('impressions')
  impressions(@Body() dto: ImpressionsDto) { return this.ads.recordImpressions(dto.ids); }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':id/click')
  click(@Param('id', ParseUUIDPipe) id: string) { return this.ads.click(id); }

  @Public() @Get(':id/overview')
  overview(@Param('id', ParseUUIDPipe) id: string) { return this.ads.overview(id); }
}
