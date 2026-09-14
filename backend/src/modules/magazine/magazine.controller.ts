import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { MagazineService } from './magazine.service';
import {
  AdminArticleQueryDto, ArticleQueryDto, CreateArticleDto, CreateIssueDto, ElevatePostDto,
  UpdateArticleDto,
} from './dto/magazine.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('magazine')
export class MagazineController {
  constructor(private magazine: MagazineService) {}

  @Public() @Get('current-issue')
  currentIssue() { return this.magazine.currentIssue(); }

  @Public() @Get('issues')
  issues() { return this.magazine.listIssues(); }

  @Public() @Get('categories')
  categories() { return this.magazine.listCategories(); }

  @Public() @Get('articles')
  articles(@Query() q: ArticleQueryDto) { return this.magazine.listArticles(q); }

  @Public() @Get('articles/:slug')
  article(@Param('slug') slug: string) { return this.magazine.getArticle(slug); }

  // ---- editorial ----

  /** Every status, not just PUBLISHED — the admin panel's article list. */
  @Roles(Role.EDITOR, Role.ADMIN) @Get('admin/articles')
  adminArticles(@Query() q: AdminArticleQueryDto) { return this.magazine.adminListArticles(q); }

  @Roles(Role.EDITOR, Role.ADMIN) @Get('admin/articles/:id')
  adminArticle(@Param('id') id: string) { return this.magazine.adminGetArticle(id); }

  @Roles(Role.EDITOR, Role.ADMIN) @Post('articles')
  create(@Body() dto: CreateArticleDto, @CurrentUser('id') userId: string) {
    return this.magazine.createArticle(dto, userId);
  }

  @Roles(Role.EDITOR, Role.ADMIN) @Patch('articles/:id')
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.magazine.updateArticle(id, dto);
  }

  @Roles(Role.EDITOR, Role.ADMIN) @Patch('articles/:id/publish')
  publish(@Param('id') id: string) { return this.magazine.publishArticle(id); }

  /** Permanent, irreversible — admin-only. Editors archive instead (PATCH status). */
  @Roles(Role.ADMIN) @Delete('articles/:id')
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.magazine.deleteArticle(id, actorId);
  }

  @Roles(Role.EDITOR, Role.ADMIN) @Get('admin/issues')
  adminIssues() { return this.magazine.adminListIssues(); }

  @Roles(Role.EDITOR, Role.ADMIN) @Post('issues')
  createIssue(@Body() dto: CreateIssueDto) { return this.magazine.createIssue(dto); }

  @Roles(Role.EDITOR, Role.ADMIN) @Patch('issues/:id/publish')
  publishIssue(@Param('id') id: string) { return this.magazine.publishIssue(id); }

  /** Promote a traveller's post into the magazine, byline intact. */
  @Roles(Role.EDITOR, Role.ADMIN) @Post('elevate')
  elevate(@Body() dto: ElevatePostDto, @CurrentUser('id') editorId: string) {
    return this.magazine.elevatePost(dto, editorId);
  }
}
