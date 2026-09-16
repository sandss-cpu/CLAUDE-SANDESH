import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { CreatorsService } from './creators.service';
import {
  AddJourneyPostDto, ApplyCreatorDto, CreatorListQueryDto, CreatorReviewDto, JourneyStatusDto,
  ReorderJourneyPostsDto, SaveJourneyDto, UpdateCreatorDto,
} from './dto/creator.dto';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('creators')
export class CreatorsController {
  constructor(private creators: CreatorsService) {}

  // ---- admin: giving and withdrawing creator access ----

  @Roles(Role.ADMIN, Role.EDITOR) @Get('admin')
  adminList(@Query() q: CreatorListQueryDto) { return this.creators.adminList(q); }

  @Roles(Role.ADMIN) @Patch('admin/:id')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatorReviewDto, @CurrentUser('id') adminId: string) {
    return this.creators.review(id, dto, adminId);
  }

  // ---- the creator's own panel ----

  @Get('me')
  me(@CurrentUser('id') userId: string) { return this.creators.dashboard(userId); }

  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('apply')
  apply(@Body() dto: ApplyCreatorDto, @CurrentUser('id') userId: string) { return this.creators.apply(dto, userId); }

  @Patch('me')
  updateMe(@Body() dto: UpdateCreatorDto, @CurrentUser('id') userId: string) { return this.creators.updateMe(dto, userId); }

  @Post('me/journeys')
  createJourney(@Body() dto: SaveJourneyDto, @CurrentUser('id') userId: string) {
    return this.creators.saveJourney(dto, userId);
  }

  @Patch('me/journeys/:id')
  updateJourney(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveJourneyDto, @CurrentUser('id') userId: string) {
    return this.creators.saveJourney(dto, userId, id);
  }

  @Patch('me/journeys/:id/status')
  setJourneyStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: JourneyStatusDto, @CurrentUser('id') userId: string) {
    return this.creators.setJourneyStatus(id, dto.status, userId);
  }

  @Delete('me/journeys/:id')
  deleteJourney(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.creators.deleteJourney(id, userId);
  }

  @Post('me/journeys/:id/posts')
  addPost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddJourneyPostDto, @CurrentUser('id') userId: string) {
    return this.creators.addPost(id, dto, userId);
  }

  @Post('me/journeys/:id/posts/reorder')
  reorderPosts(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderJourneyPostsDto, @CurrentUser('id') userId: string) {
    return this.creators.reorderPosts(id, dto, userId);
  }

  @Delete('me/journeys/:id/posts/:postId')
  removePost(
    @Param('id', ParseUUIDPipe) id: string, @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.creators.removePost(id, postId, userId);
  }

  // ---- readers ----

  @Public() @Get()
  list(@Query() q: CreatorListQueryDto) { return this.creators.list(q); }

  @OptionalAuth() @Get(':handle')
  profile(@Param('handle') handle: string, @CurrentUser() user?: AuthUser) {
    return this.creators.profile(handle, user?.id);
  }

  @Public() @Get(':handle/journeys/:slug')
  journey(@Param('handle') handle: string, @Param('slug') slug: string) {
    return this.creators.journey(handle, slug);
  }

  @Post(':handle/follow')
  follow(@Param('handle') handle: string, @CurrentUser('id') userId: string) {
    return this.creators.follow(handle, userId);
  }

  @Delete(':handle/follow')
  unfollow(@Param('handle') handle: string, @CurrentUser('id') userId: string) {
    return this.creators.unfollow(handle, userId);
  }
}
