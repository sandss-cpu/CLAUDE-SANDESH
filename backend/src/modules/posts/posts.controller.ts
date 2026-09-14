import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PostsService } from './posts.service';
import { CreatePostDto, PostQueryDto, UpdatePostDto } from './dto/post.dto';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('posts')
export class PostsController {
  constructor(private posts: PostsService) {}

  @Public() @Get()
  list(@Query() q: PostQueryDto) { return this.posts.list(q); }

  @Public() @Get('map-pins')
  pins(
    @Query('minLat') minLat: string, @Query('minLng') minLng: string,
    @Query('maxLat') maxLat: string, @Query('maxLng') maxLng: string,
  ) {
    return this.posts.mapPins({
      minLat: Number(minLat), minLng: Number(minLng),
      maxLat: Number(maxLat), maxLng: Number(maxLng),
    });
  }

  @Get('mine')
  mine(@CurrentUser('id') userId: string, @Query() q: PostQueryDto) {
    return this.posts.myPosts(userId, q);
  }

  @OptionalAuth() @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.posts.findOne(id, user?.id);
  }

  /** Save a draft. Works offline; the client replays this on reconnection. */
  @Post()
  create(@Body() dto: CreatePostDto, @CurrentUser('id') userId: string) {
    return this.posts.create(dto, userId, false);
  }

  /** Two-tap publish: create and submit for moderation in one call. */
  @Post('publish')
  createAndPublish(@Body() dto: CreatePostDto, @CurrentUser('id') userId: string) {
    return this.posts.create(dto, userId, true);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePostDto, @CurrentUser('id') userId: string) {
    return this.posts.update(id, dto, userId);
  }

  @Patch(':id/submit')
  submit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.posts.submit(id, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.posts.remove(id, user.id, user.role as Role);
  }
}
