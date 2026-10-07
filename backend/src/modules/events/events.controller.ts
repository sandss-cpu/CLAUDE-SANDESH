import { Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PurgeSite } from '../../common/site-purge/site-purge.service';
import { EventListQueryDto, SaveEventDto } from './dto/event.dto';
import { EventsService } from './events.service';

/**
 * Events and happenings for the website's Events page. Editors and admins only: the
 * website reads published events straight from the database, through its own role.
 */
@Controller('events')
@Roles(Role.EDITOR, Role.ADMIN)
export class EventsController {
  constructor(private events: EventsService) {}

  @Get('admin')
  list(@Query() q: EventListQueryDto) { return this.events.list(q); }

  @Get('admin/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.events.get(id); }

  @PurgeSite() @Post()
  create(@Body() dto: SaveEventDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.events.create(dto, actorId, ip);
  }

  @PurgeSite() @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveEventDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.events.update(id, dto, actorId, ip);
  }

  @PurgeSite() @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.events.remove(id, actorId, ip);
  }
}
