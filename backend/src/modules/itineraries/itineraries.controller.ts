import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BudgetStyle } from '@prisma/client';
import { ItinerariesService } from './itineraries.service';
import {
  CreateItineraryDto, FromArticleDto, SuggestItineraryDto, UpdateItineraryDto,
} from './dto/itinerary.dto';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('itineraries')
export class ItinerariesController {
  constructor(private itineraries: ItinerariesService) {}

  @Public() @Get('templates')
  templates() { return this.itineraries.templates(); }

  @Public() @Get('permits')
  permits(@Query('region') region?: string) { return this.itineraries.permits(region); }

  @Public() @Get('budget')
  budget(@Query('days') days: string, @Query('style') style?: BudgetStyle) {
    return this.itineraries.budgetBreakdown(Number(days ?? 3), style ?? BudgetStyle.STANDARD);
  }

  @Public() @Get('shared/:token')
  shared(@Param('token') token: string) { return this.itineraries.byShareToken(token); }

  @Get('mine')
  mine(@CurrentUser('id') userId: string) { return this.itineraries.mine(userId); }

  @OptionalAuth() @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.itineraries.findOne(id, user?.id);
  }

  @Post()
  create(@Body() dto: CreateItineraryDto, @CurrentUser('id') userId: string) {
    return this.itineraries.create(dto, userId);
  }

  /** One tap: article becomes an editable trip plan. */
  @Post('from-article')
  fromArticle(@Body() dto: FromArticleDto, @CurrentUser('id') userId: string) {
    return this.itineraries.fromArticle(dto, userId);
  }

  @Post('suggest')
  suggest(@Body() dto: SuggestItineraryDto, @CurrentUser('id') userId: string) {
    return this.itineraries.suggest(dto, userId);
  }

  @Post(':id/fork')
  fork(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.itineraries.fork(id, userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateItineraryDto, @CurrentUser('id') userId: string) {
    return this.itineraries.update(id, dto, userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.itineraries.remove(id, userId);
  }
}
