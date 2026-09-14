import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Role, TargetType } from '@prisma/client';
import { EngagementService } from './engagement.service';
import { BookmarkDto, CommentDto, ReactDto } from './dto/engagement.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('engagement')
export class EngagementController {
  constructor(private engagement: EngagementService) {}

  @Post('react')
  react(@Body() dto: ReactDto, @CurrentUser('id') userId: string) {
    return this.engagement.react(dto, userId);
  }

  @Public() @Get('reactions')
  counts(@Query('targetType') t: TargetType, @Query('targetId') id: string) {
    return this.engagement.counts(t, id);
  }

  @Post('bookmark')
  bookmark(@Body() dto: BookmarkDto, @CurrentUser('id') userId: string) {
    return this.engagement.bookmark(dto, userId);
  }

  @Get('bookmarks')
  myBookmarks(@CurrentUser('id') userId: string) {
    return this.engagement.myBookmarks(userId);
  }

  @Post('comments')
  comment(@Body() dto: CommentDto, @CurrentUser('id') userId: string) {
    return this.engagement.comment(dto, userId);
  }

  @Public() @Get('comments')
  listComments(@Query('targetType') t: TargetType, @Query('targetId') id: string) {
    return this.engagement.listComments(t, id);
  }

  @Delete('comments/:id')
  deleteComment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.engagement.deleteComment(id, user.id, user.role as Role);
  }
}
