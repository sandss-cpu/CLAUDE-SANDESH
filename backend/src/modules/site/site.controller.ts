import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PurgeSite } from '../../common/site-purge/site-purge.service';
import { sendFile } from '../../common/utils/send-file';
import { SiteKeyGuard } from './site-key.guard';
import {
  EnquiryStatusDto, ListQueryDto, MonthQueryDto, NewsletterDto, PackageDto, SiteEnquiryDto, SiteLeadDto, TokenDto, UpdatePackageDto,
  WebsiteArticleDto, WebsiteArticlesQueryDto,
} from './site.dto';
import { SiteService } from './site.service';

type SiteRequest = { siteClientIp?: string; ip: string };

/** What the public website posts, server to server, with its key. */
@Controller('site')
export class SiteController {
  constructor(private site: SiteService) {}

  @Public() @UseGuards(SiteKeyGuard) @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post('leads')
  lead(@Body() dto: SiteLeadDto) { return this.site.lead(dto); }

  @Public() @UseGuards(SiteKeyGuard) @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('enquiries')
  enquiry(@Body() dto: SiteEnquiryDto, @Req() req: SiteRequest) { return this.site.enquiry(dto, req.siteClientIp ?? req.ip); }

  @Public() @UseGuards(SiteKeyGuard) @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('newsletter')
  subscribe(@Body() dto: NewsletterDto, @Req() req: SiteRequest) { return this.site.subscribe(dto, req.siteClientIp ?? req.ip); }

  @Public() @UseGuards(SiteKeyGuard)
  @Post('newsletter/confirm')
  confirm(@Body() dto: TokenDto) { return this.site.confirm(dto.token); }

  @Public() @UseGuards(SiteKeyGuard)
  @Post('newsletter/unsubscribe')
  unsubscribe(@Body() dto: TokenDto) { return this.site.unsubscribe(dto.token); }

  /** Public figures for "Advertise with Batoma". */
  @Public() @Get('audience')
  audience() { return this.site.audience(); }
}

/** A partner's own enquiries and monthly report. Owners of the listing, and Batoma's admins. */
@Controller('businesses')
export class PartnerAreaController {
  constructor(private site: SiteService) {}

  @Get(':id/leads')
  leads(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListQueryDto, @CurrentUser() u: AuthUser) {
    return this.site.leads(id, { id: u.id, role: u.role as Role }, q.page ?? 1);
  }

  @Get(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string, @Query() q: MonthQueryDto, @CurrentUser() u: AuthUser) {
    return this.site.report(id, { id: u.id, role: u.role as Role }, q.month);
  }

  @Get(':id/report.csv')
  async reportCsv(@Param('id', ParseUUIDPipe) id: string, @Query() q: MonthQueryDto, @CurrentUser() u: AuthUser, @Res() res: Response) {
    sendFile(res, await this.site.reportCsv(id, { id: u.id, role: u.role as Role }, q.month));
  }

  @Get(':id/report.pdf')
  async reportPdf(@Param('id', ParseUUIDPipe) id: string, @Query() q: MonthQueryDto, @CurrentUser() u: AuthUser, @Res() res: Response) {
    sendFile(res, await this.site.reportPdf(id, { id: u.id, role: u.role as Role }, q.month));
  }
}

/** The website's articles, partner packages, the enquiry inbox and the newsletter list, for Batoma's admins. */
@Controller('admin')
@Roles(Role.ADMIN)
export class SiteAdminController {
  constructor(private site: SiteService) {}

  @Get('partner-packages')
  packages(@Query() q: ListQueryDto) { return this.site.packages(q); }

  @Post('partner-packages')
  createPackage(@Body() dto: PackageDto, @CurrentUser('id') uid: string, @Ip() ip: string) { return this.site.createPackage(dto, uid, ip); }

  @Patch('partner-packages/:id')
  updatePackage(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.site.updatePackage(id, dto, uid, ip);
  }

  @Get('partner-packages/report/:businessId')
  partnerReport(@Param('businessId', ParseUUIDPipe) id: string, @Query() q: MonthQueryDto, @CurrentUser() u: AuthUser) {
    return this.site.report(id, { id: u.id, role: Role.ADMIN }, q.month);
  }

  @Get('site/overview')
  websiteOverview() { return this.site.websiteOverview(); }

  @Get('site/articles')
  websiteArticles(@Query() q: WebsiteArticlesQueryDto) { return this.site.websiteArticles(q); }

  @PurgeSite()
  @Patch('site/articles/:id')
  websiteArticle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: WebsiteArticleDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.site.setArticleWebsite(id, dto, uid, ip);
  }

  @Get('site/enquiries')
  enquiries(@Query() q: ListQueryDto) { return this.site.enquiries(q); }

  @Patch('site/enquiries/:id')
  enquiryStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EnquiryStatusDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.site.setEnquiryStatus(id, dto.status, uid, ip);
  }

  @Get('site/newsletter')
  newsletter() { return this.site.newsletterSummary(); }

  @Get('site/newsletter.csv')
  async newsletterCsv(@CurrentUser('id') uid: string, @Ip() ip: string, @Res() res: Response) {
    sendFile(res, await this.site.newsletterCsv(uid, ip));
  }
}
