import {
  Body, Controller, Delete, Get, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { sendFile } from '../../common/utils/send-file';
import {
  DayQueryDto, FinanceSettingsDto, ImportFormDto, ReportQueryDto, SaveSheetDto, SourceDto, UpdateSourceDto,
} from './dto/finance.dto';
import { IncomeImportService, UploadedSheet } from './income-import.service';
import { IncomeReportsService } from './income-reports.service';
import { IncomeService } from './income.service';

const SHEET_UPLOAD = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const PHOTO_UPLOAD = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/**
 * Daily income and ticket records, under /fleet like the rest of the owner portal. Every
 * route goes through FinanceAccessService, which starts with company membership.
 */
@Controller('fleet')
export class FinanceController {
  constructor(private income: IncomeService, private imports: IncomeImportService, private reports: IncomeReportsService, private audit: AuditService) {}

  /** A company's money leaving the system as a file is a security event. */
  private exported(cid: string, uid: string, ip: string, kind: string, q: ReportQueryDto) {
    return this.audit.record({
      actorId: uid, action: 'income.export', entityType: 'Operator', entityId: cid, operatorId: cid, ip,
      summary: `Downloaded the income report as ${kind}${q.from || q.to ? ` (${q.from ?? '…'} to ${q.to ?? '…'})` : ''}`,
    });
  }

  // ---- settings and sources ----

  @Get('companies/:cid/finance')
  settings(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.income.settings(cid, uid); }

  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Patch('companies/:cid/finance')
  updateSettings(@Param('cid') cid: string, @Body() dto: FinanceSettingsDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.income.updateSettings(cid, dto, uid, ip);
  }

  @Get('companies/:cid/income/sources')
  sources(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.income.sources(cid, uid); }

  @Post('companies/:cid/income/sources')
  addSource(@Param('cid') cid: string, @Body() dto: SourceDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.income.addSource(cid, dto, uid, ip);
  }

  @Patch('income/sources/:sid')
  updateSource(@Param('sid', ParseUUIDPipe) sid: string, @Body() dto: UpdateSourceDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.income.updateSource(sid, dto, uid, ip);
  }

  // ---- the daily sheet ----

  @Get('buses/:id/income')
  sheet(@Param('id') id: string, @Query() q: DayQueryDto, @CurrentUser('id') uid: string) { return this.income.sheet(id, q.date, uid); }

  @Put('buses/:id/income/:date')
  saveSheet(@Param('id') id: string, @Param('date') date: string, @Body() dto: SaveSheetDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.income.saveSheet(id, date, dto, uid, ip);
  }

  @Delete('income/:eid')
  remove(@Param('eid', ParseUUIDPipe) eid: string, @CurrentUser('id') uid: string, @Ip() ip: string) { return this.income.remove(eid, uid, ip); }

  @Throttle({ default: { limit: 30, ttl: 900_000 } })
  @Post('income/:eid/attachment')
  @UseInterceptors(PHOTO_UPLOAD)
  attach(@Param('eid', ParseUUIDPipe) eid: string, @UploadedFile() file: { buffer: Buffer; size: number }, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.income.attach(eid, file, uid, ip);
  }

  @Get('income/:eid/attachment')
  attachment(@Param('eid', ParseUUIDPipe) eid: string, @CurrentUser('id') uid: string) { return this.income.attachment(eid, uid); }

  // ---- imports ----

  @Throttle({ default: { limit: 30, ttl: 900_000 } })
  @Post('companies/:cid/income/import/preview')
  @UseInterceptors(SHEET_UPLOAD)
  preview(@Param('cid') cid: string, @UploadedFile() file: UploadedSheet, @Body() form: ImportFormDto, @CurrentUser('id') uid: string) {
    return this.imports.preview(cid, file, form, uid);
  }

  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('companies/:cid/income/import')
  @UseInterceptors(SHEET_UPLOAD)
  commit(@Param('cid') cid: string, @UploadedFile() file: UploadedSheet, @Body() form: ImportFormDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.imports.commit(cid, file, form, uid, ip);
  }

  @Get('companies/:cid/income/imports')
  importList(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.imports.list(cid, uid); }

  @Post('income/imports/:iid/undo')
  undo(@Param('iid', ParseUUIDPipe) iid: string, @CurrentUser('id') uid: string, @Ip() ip: string) { return this.imports.undo(iid, uid, ip); }

  // ---- totals ----

  @Get('companies/:cid/income/dashboard')
  dashboard(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.reports.dashboard(cid, uid); }

  @Get('companies/:cid/income/report')
  report(@Param('cid') cid: string, @Query() q: ReportQueryDto, @CurrentUser('id') uid: string) { return this.reports.report(cid, q, uid); }

  @Get('companies/:cid/income/reconciliation')
  reconciliation(@Param('cid') cid: string, @Query() q: ReportQueryDto, @CurrentUser('id') uid: string) {
    return this.reports.reconciliation(cid, q, uid);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('companies/:cid/income/report.csv')
  async reportCsv(@Param('cid') cid: string, @Query() q: ReportQueryDto, @CurrentUser('id') uid: string, @Ip() ip: string, @Res() res: Response) {
    const file = await this.reports.csv(cid, q, uid);
    await this.exported(cid, uid, ip, 'CSV', q);
    sendFile(res, file);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('companies/:cid/income/report.pdf')
  async reportPdf(@Param('cid') cid: string, @Query() q: ReportQueryDto, @CurrentUser('id') uid: string, @Ip() ip: string, @Res() res: Response) {
    const file = await this.reports.pdf(cid, q, uid);
    await this.exported(cid, uid, ip, 'PDF', q);
    sendFile(res, file);
  }
}
