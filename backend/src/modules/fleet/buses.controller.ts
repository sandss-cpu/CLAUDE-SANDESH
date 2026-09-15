import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusReviewsService } from './bus-reviews.service';
import { ScanDto, SubmitReviewDto } from './dto/fleet.dto';

/** Public bus profiles for passengers. Literal paths sit above `:id`. */
@Controller('buses')
export class BusesController {
  constructor(private reviews: BusReviewsService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('search')
  search(@Query('q') q?: string) { return this.reviews.search(q); }

  /** What a bus or company QR code opens. Also hands back a short-lived token that proves the scan. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('scan/:code')
  scan(@Param('code') code: string, @Body() dto: ScanDto, @Ip() ip: string) {
    return this.reviews.scan(code, dto.sessionId, ip);
  }

  @Public()
  @Get('companies/:slug')
  company(@Param('slug') slug: string) { return this.reviews.companyProfile(slug); }

  @Public()
  @Get(':id')
  profile(@Param('id') id: string) { return this.reviews.profile(id); }

  @Public()
  @Get(':id/reviews')
  reviewPage(@Param('id') id: string, @Query('page') page?: string) {
    return this.reviews.publicReviews(id, Math.max(1, Number(page) || 1));
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  @Post(':id/reviews')
  submit(@Param('id') id: string, @Body() dto: SubmitReviewDto, @Ip() ip: string, @CurrentUser() user?: AuthUser) {
    return this.reviews.submit(id, dto, user, ip);
  }
}
