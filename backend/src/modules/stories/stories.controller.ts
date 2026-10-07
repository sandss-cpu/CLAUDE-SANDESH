import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeclineStoryDto, FeatureStoryDto, StoryListQueryDto } from './dto/story.dto';
import { StoriesService } from './stories.service';

/**
 * Stories sent from the website, for editors and admins to read, feature in the magazine
 * or decline. The website's own form posts to /site/stories with its key.
 */
@Controller('stories')
@Roles(Role.EDITOR, Role.ADMIN)
export class StoriesController {
  constructor(private stories: StoriesService) {}

  @Get('admin')
  list(@Query() q: StoryListQueryDto) { return this.stories.list(q.status); }

  @Get('admin/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.stories.get(id); }

  @Post('admin/:id/feature')
  feature(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeatureStoryDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.stories.feature(id, dto, actorId, ip);
  }

  @Post('admin/:id/decline')
  decline(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineStoryDto, @CurrentUser('id') actorId: string, @Ip() ip: string) {
    return this.stories.decline(id, dto, actorId, ip);
  }
}
