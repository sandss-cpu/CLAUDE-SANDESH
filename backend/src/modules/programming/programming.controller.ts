import {
  Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ProgrammingService } from './programming.service';
import {
  AssignRoutesDto, CopyDirectionDto, CreatePlacementDto, HistoryQueryDto, NoticeQueryDto,
  PreviewQueryDto, ReorderPlacementsDto, RouteBusesQueryDto, SaveNoticeDto, SlotQueryDto,
  UpdatePlacementDto,
} from './dto/programming.dto';

/** Editors and admins decide what each bus shows; moderators can see it but not change it. */
const READ = [Role.EDITOR, Role.ADMIN, Role.MODERATOR];
const WRITE = [Role.EDITOR, Role.ADMIN];

/** Route programming for the control panel. Literal paths sit above `:id`. */
@Controller('programming')
export class ProgrammingController {
  constructor(private programming: ProgrammingService) {}

  @Roles(...READ) @Get('placements')
  list(@Query() q: SlotQueryDto) { return this.programming.list(q); }

  @Roles(...READ) @Get('buses')
  buses(@Query() q: RouteBusesQueryDto) { return this.programming.routeBuses(q.routeId); }

  @Roles(...READ) @Get('preview')
  preview(@Query() q: PreviewQueryDto) { return this.programming.preview(q); }

  @Roles(...READ) @Get('history')
  history(@Query() q: HistoryQueryDto) { return this.programming.history(q); }

  @Roles(...READ) @Get('notices')
  notices(@Query() q: NoticeQueryDto) { return this.programming.listNotices(q.routeId); }

  @Roles(...WRITE) @Post('placements/reorder')
  reorder(@Body() dto: ReorderPlacementsDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.reorder(dto, actorId, ip);
  }

  @Roles(...WRITE) @Post('placements')
  create(@Body() dto: CreatePlacementDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.create(dto, actorId, ip);
  }

  @Roles(...WRITE) @Patch('placements/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlacementDto,
    @CurrentUser('id') actorId: string, @Ip() ip: string,
  ) {
    return this.programming.update(id, dto, actorId, ip);
  }

  @Roles(...WRITE) @Delete('placements/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.remove(id, actorId, ip);
  }

  @Roles(...WRITE) @Post('copy-direction')
  copyDirection(@Body() dto: CopyDirectionDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.copyDirection(dto, actorId, ip);
  }

  @Roles(...WRITE) @Post('assign')
  assign(@Body() dto: AssignRoutesDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.assignRoutes(dto, actorId, ip);
  }

  @Roles(...WRITE) @Post('notices')
  createNotice(@Body() dto: SaveNoticeDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.createNotice(dto, actorId, ip);
  }

  @Roles(...WRITE) @Patch('notices/:id')
  updateNotice(
    @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveNoticeDto,
    @CurrentUser('id') actorId: string, @Ip() ip: string,
  ) {
    return this.programming.updateNotice(id, dto, actorId, ip);
  }

  @Roles(...WRITE) @Delete('notices/:id')
  removeNotice(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.programming.removeNotice(id, actorId, ip);
  }
}
