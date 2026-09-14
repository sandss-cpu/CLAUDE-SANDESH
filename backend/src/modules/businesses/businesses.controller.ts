import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { BusinessTier, Role } from '@prisma/client';
import { BusinessesService } from './businesses.service';
import {
  BusinessQueryDto, CreateBusinessDto, CreateCouponDto, LeadDto, ReviewDto,
  TargetRoutesDto, UpdateBusinessDto, VerifyBusinessDto,
} from './dto/business.dto';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('businesses')
export class BusinessesController {
  constructor(private businesses: BusinessesService) {}

  @Public() @Get()
  list(@Query() q: BusinessQueryDto) { return this.businesses.list(q); }

  @Get('mine')
  mine(@CurrentUser('id') userId: string) { return this.businesses.myBusinesses(userId); }

  /** Verification worklist. Declared before :slug so the literal path wins. */
  @Roles(Role.ADMIN, Role.MODERATOR) @Get('admin/pending-verification')
  pending(@Query() q: BusinessQueryDto) { return this.businesses.verificationQueue(q); }

  @Public() @Get(':slug')
  findOne(@Param('slug') slug: string) { return this.businesses.findOne(slug); }

  @Roles(Role.BUSINESS_OWNER, Role.ADMIN) @Post()
  create(@Body() dto: CreateBusinessDto, @CurrentUser('id') userId: string) {
    return this.businesses.create(dto, userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBusinessDto, @CurrentUser() u: AuthUser) {
    return this.businesses.update(id, dto, u.id, u.role as Role);
  }

  @Roles(Role.ADMIN, Role.MODERATOR) @Patch(':id/verify')
  verify(@Param('id') id: string, @Body() dto: VerifyBusinessDto, @CurrentUser('id') adminId: string) {
    return this.businesses.verify(id, dto, adminId);
  }

  @Roles(Role.ADMIN) @Patch(':id/tier')
  tier(
    @Param('id') id: string,
    @Body('tier') tier: BusinessTier,
    @CurrentUser('id') actorId: string,
    @Body('months') months?: number,
  ) {
    return this.businesses.setTier(id, tier, months ?? 1, actorId);
  }

  /** Paid feature: appear to readers scanning on specific corridors. */
  @Patch(':id/routes')
  routes(@Param('id') id: string, @Body() dto: TargetRoutesDto, @CurrentUser() u: AuthUser) {
    return this.businesses.targetRoutes(id, dto, u.id, u.role as Role);
  }

  /** Attribution: every call, WhatsApp tap and directions request is a lead. */
  @OptionalAuth() @Post(':id/lead')
  lead(@Param('id') id: string, @Body() dto: LeadDto, @CurrentUser() u?: AuthUser) {
    return this.businesses.recordLead(id, dto, u?.id);
  }

  @Get(':id/dashboard')
  dashboard(@Param('id') id: string, @CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.businesses.dashboard(id, u.id, u.role as Role, Number(days ?? 30));
  }

  // ---- coupons ----

  @Post(':id/coupons')
  createCoupon(@Param('id') id: string, @Body() dto: CreateCouponDto, @CurrentUser() u: AuthUser) {
    return this.businesses.createCoupon(id, dto, u.id, u.role as Role);
  }

  /** Traveller claims: "show this screen for 10% off". */
  @Post('coupons/:couponId/claim')
  claim(
    @Param('couponId') couponId: string,
    @CurrentUser('id') userId: string,
    @Body('routeId') routeId?: string,
  ) {
    return this.businesses.claimCoupon(couponId, userId, routeId);
  }

  /** Business marks the code used at the counter. */
  @Post('coupons/redeem/:code')
  redeem(@Param('code') code: string, @CurrentUser() u: AuthUser) {
    return this.businesses.redeemCoupon(code, u.id, u.role as Role);
  }

  // ---- reviews ----

  @Post(':id/reviews')
  review(@Param('id') id: string, @Body() dto: ReviewDto, @CurrentUser('id') userId: string) {
    return this.businesses.review(id, dto, userId);
  }

  @Patch('reviews/:reviewId/reply')
  reply(@Param('reviewId') id: string, @Body('reply') reply: string, @CurrentUser() u: AuthUser) {
    return this.businesses.replyToReview(id, reply, u.id, u.role as Role);
  }
}
