import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { GuidesService } from './guides.service';
import {
  AdminGuideQueryDto, GuideDirectionQueryDto, GuideStatusDto, JourneyQueryDto, ReorderStopsDto,
  SaveGuideDto, SaveGuideStopDto,
} from './dto/guide.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('guides')
export class GuidesController {
  constructor(private guides: GuidesService) {}

  // ---- admin and editors (literal paths before ":id") ----

  @Roles(Role.ADMIN, Role.EDITOR) @Get('admin')
  adminList(@Query() q: AdminGuideQueryDto) { return this.guides.adminList(q); }

  @Roles(Role.ADMIN, Role.EDITOR) @Get('admin/:id')
  adminOne(@Param('id', ParseUUIDPipe) id: string) { return this.guides.adminOne(id); }

  @Roles(Role.ADMIN, Role.EDITOR) @Post('admin')
  create(@Body() dto: SaveGuideDto, @CurrentUser('id') actorId: string) { return this.guides.create(dto, actorId); }

  @Roles(Role.ADMIN, Role.EDITOR) @Patch('admin/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveGuideDto) { return this.guides.update(id, dto); }

  @Roles(Role.ADMIN, Role.EDITOR) @Patch('admin/:id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GuideStatusDto) {
    return this.guides.setStatus(id, dto.status);
  }

  @Roles(Role.ADMIN, Role.EDITOR) @Delete('admin/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.guides.remove(id); }

  @Roles(Role.ADMIN, Role.EDITOR) @Post('admin/:id/stops')
  addStop(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveGuideStopDto) {
    return this.guides.addStop(id, dto);
  }

  @Roles(Role.ADMIN, Role.EDITOR) @Post('admin/:id/stops/reorder')
  reorder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderStopsDto) {
    return this.guides.reorder(id, dto);
  }

  @Roles(Role.ADMIN, Role.EDITOR) @Patch('admin/stops/:stopId')
  updateStop(@Param('stopId', ParseUUIDPipe) stopId: string, @Body() dto: SaveGuideStopDto) {
    return this.guides.updateStop(stopId, dto);
  }

  @Roles(Role.ADMIN, Role.EDITOR) @Delete('admin/stops/:stopId')
  removeStop(@Param('stopId', ParseUUIDPipe) stopId: string) { return this.guides.removeStop(stopId); }

  // ---- travellers ----

  /** "Where are you heading?" — the journeys with a published guide. */
  @Public() @Get('journeys')
  journeys(@Query() q: JourneyQueryDto) { return this.guides.journeys(q); }

  @Public() @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Query() q: GuideDirectionQueryDto) {
    return this.guides.findOne(id, q.direction);
  }
}
