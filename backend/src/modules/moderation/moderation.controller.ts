import { Body, Controller, Get, Ip, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, TargetType } from '@prisma/client';
import { ModerationService } from './moderation.service';
import { CreateReportDto, ModerateDto } from './dto/moderation.dto';
import { OptionalAuth } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('moderation')
export class ModerationController {
  constructor(private moderation: ModerationService) {}

  /** Anyone can report, signed in or not. Required by Apple Guideline 1.2. */
  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('report')
  report(@Body() dto: CreateReportDto, @Ip() ip: string, @CurrentUser() u?: AuthUser) {
    return this.moderation.report(dto, u?.id, ip);
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('queue')
  queue() { return this.moderation.queueStats(); }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('reports')
  reports(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.moderation.openReports(Number(skip ?? 0), Number(take ?? 50));
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('posts')
  posts(@Query('skip') skip?: string) {
    return this.moderation.pendingPosts(Number(skip ?? 0));
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('comments')
  comments(@Query('skip') skip?: string) {
    return this.moderation.pendingComments(Number(skip ?? 0));
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('reviews')
  reviews(@Query('skip') skip?: string) {
    return this.moderation.pendingReviews(Number(skip ?? 0));
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Post('act')
  act(@Body() dto: ModerateDto, @CurrentUser('id') moderatorId: string) {
    return this.moderation.act(dto, moderatorId);
  }

  @Roles(Role.MODERATOR, Role.ADMIN) @Get('audit')
  audit(@Query('targetType') t: TargetType, @Query('targetId') id: string) {
    return this.moderation.auditTrail(t, id);
  }
}
