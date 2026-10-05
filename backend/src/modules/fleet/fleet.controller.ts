import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FleetService } from './fleet.service';
import { FleetRecordsService } from './fleet-records.service';
import { BusReviewsService } from './bus-reviews.service';
import { TripsService } from './trips.service';
import { StickersService } from './stickers.service';
import { ScorecardService } from './scorecard.service';
import { AppraisalsService } from './appraisals.service';
import { FleetAccessService } from './fleet-access.service';
import type { Response } from 'express';
import { sendFile as send } from '../../common/utils/send-file';
import {
  AddMemberDto, ArchiveBusDto, AssignDriverDto, BusListQueryDto, CreateBusDto, CreateCompanyDto, DocumentDto,
  DriverDto, FuelDto, IncidentDto, MaintenanceDto, OwnerReportDto, ReplyDto, ResolveIncidentDto,
  ReviewListQueryDto, UpdateBusDto, UpdateCompanyDto,
  EndTripDto, StartTripDto, StickerQueryDto, TripListQueryDto, UnlockTripDto, UpdateTripDto,
  AppraisalListQueryDto, CreateAppraisalDto, ScorecardQueryDto, UpdateAppraisalDto,
} from './dto/fleet.dto';


/**
 * The bus owner portal. Every route needs a signed-in account; which companies
 * and buses it can touch is decided by membership inside the services.
 */
@Controller('fleet')
export class FleetController {
  constructor(
    private fleet: FleetService,
    private records: FleetRecordsService,
    private reviews: BusReviewsService,
    private trips: TripsService,
    private stickers: StickersService,
    private access: FleetAccessService,
    private scorecards: ScorecardService,
    private appraisals: AppraisalsService,
  ) {}

  // ---- scorecards and appraisals (owners and managers; the leaderboard is owners only) ----

  @Get('drivers/:id/scorecard')
  scorecard(@Param('id') id: string, @Query() q: ScorecardQueryDto, @CurrentUser('id') uid: string) {
    return this.scorecards.scorecard(id, q.from, q.to, uid);
  }

  @Get('companies/:cid/leaderboard')
  leaderboard(@Param('cid') cid: string, @Query() q: ScorecardQueryDto, @CurrentUser('id') uid: string) {
    return this.scorecards.leaderboard(cid, q.from, q.to, uid);
  }

  @Get('companies/:cid/appraisals')
  companyAppraisals(@Param('cid') cid: string, @Query() q: AppraisalListQueryDto, @CurrentUser('id') uid: string) {
    return this.appraisals.forCompany(cid, q, uid);
  }

  @Get('drivers/:id/appraisals')
  driverAppraisals(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.appraisals.forDriver(id, uid); }

  @Post('drivers/:id/appraisals')
  createAppraisal(@Param('id') id: string, @Body() dto: CreateAppraisalDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.appraisals.create(id, dto, uid, ip);
  }

  @Get('appraisals/:aid')
  appraisal(@Param('aid') aid: string, @CurrentUser('id') uid: string) { return this.appraisals.one(aid, uid); }

  @Patch('appraisals/:aid')
  updateAppraisal(@Param('aid') aid: string, @Body() dto: UpdateAppraisalDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.appraisals.update(aid, dto, uid, ip);
  }

  @Post('appraisals/:aid/finalise')
  finaliseAppraisal(@Param('aid') aid: string, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.appraisals.finalise(aid, uid, ip);
  }

  @Post('appraisals/:aid/acknowledge')
  acknowledgeAppraisal(@Param('aid') aid: string, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.appraisals.acknowledge(aid, uid, ip);
  }

  @Delete('appraisals/:aid')
  deleteAppraisal(@Param('aid') aid: string, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.appraisals.remove(aid, uid, ip);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('appraisals/:aid/pdf')
  async appraisalPdf(@Param('aid') aid: string, @CurrentUser('id') uid: string, @Res() res: Response) {
    send(res, await this.appraisals.pdf(aid, uid));
  }

  // ---- trips: the duty log (crew accounts can start and end them) ----

  @Get('companies/:cid/duty')
  duty(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.trips.duty(cid, uid); }

  @Get('companies/:cid/trips')
  listTrips(@Param('cid') cid: string, @Query() q: TripListQueryDto, @CurrentUser('id') uid: string) {
    return this.trips.list(cid, q, uid);
  }

  @Post('buses/:id/trips')
  startTrip(@Param('id') id: string, @Body() dto: StartTripDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.trips.start(id, dto, uid, ip);
  }

  @Get('trips/:tid')
  trip(@Param('tid') tid: string, @CurrentUser('id') uid: string) { return this.trips.one(tid, uid); }

  @Post('trips/:tid/end')
  endTrip(@Param('tid') tid: string, @Body() dto: EndTripDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.trips.end(tid, dto, uid, ip);
  }

  @Patch('trips/:tid')
  updateTrip(@Param('tid') tid: string, @Body() dto: UpdateTripDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.trips.update(tid, dto, uid, ip);
  }

  @Post('trips/:tid/unlock')
  unlockTrip(@Param('tid') tid: string, @Body() dto: UnlockTripDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.trips.unlock(tid, dto, uid, ip);
  }

  // ---- companies ----

  @Get('companies')
  myCompanies(@CurrentUser('id') uid: string) { return this.fleet.myCompanies(uid); }

  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('companies')
  createCompany(@Body() dto: CreateCompanyDto, @CurrentUser('id') uid: string) { return this.fleet.createCompany(dto, uid); }

  @Get('companies/:cid')
  company(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.company(cid, uid); }

  @Patch('companies/:cid')
  updateCompany(@Param('cid') cid: string, @Body() dto: UpdateCompanyDto, @CurrentUser('id') uid: string) {
    return this.fleet.updateCompany(cid, dto, uid);
  }

  @Get('companies/:cid/dashboard')
  dashboard(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.dashboard(cid, uid); }

  @Get('companies/:cid/buses')
  buses(@Param('cid') cid: string, @Query() q: BusListQueryDto, @CurrentUser('id') uid: string) {
    return this.fleet.listBuses(cid, q, uid);
  }

  @Post('companies/:cid/buses')
  createBus(@Param('cid') cid: string, @Body() dto: CreateBusDto, @CurrentUser('id') uid: string) {
    return this.fleet.createBus(cid, dto, uid);
  }

  @Get('companies/:cid/reviews')
  companyReviews(@Param('cid') cid: string, @Query() q: ReviewListQueryDto, @CurrentUser('id') uid: string) {
    return this.reviews.ownerReviews(cid, q, uid);
  }

  @Get('companies/:cid/drivers')
  drivers(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.records.drivers(cid, uid); }

  @Post('companies/:cid/drivers')
  addDriver(@Param('cid') cid: string, @Body() dto: DriverDto, @CurrentUser('id') uid: string) {
    return this.records.addDriver(cid, dto, uid);
  }

  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post('companies/:cid/members')
  addMember(@Param('cid') cid: string, @Body() dto: AddMemberDto, @CurrentUser('id') uid: string) {
    return this.fleet.addMember(cid, dto, uid);
  }

  @Delete('companies/:cid/members/:userId')
  removeMember(@Param('cid') cid: string, @Param('userId') memberId: string, @CurrentUser('id') uid: string) {
    return this.fleet.removeMember(cid, memberId, uid);
  }

  @Get('companies/:cid/qr')
  companyQr(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.companyQr(cid, uid); }

  @Post('companies/:cid/qr/rotate')
  rotateCompanyQr(@Param('cid') cid: string, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.fleet.rotateCompanyQr(cid, uid, ip);
  }

  /** Every active bus's sticker on A4 sheets, ready to cut. */
  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Get('companies/:cid/qr/stickers.pdf')
  async fleetStickers(@Param('cid') cid: string, @Query() q: StickerQueryDto, @CurrentUser('id') uid: string, @Res() res: Response) {
    await this.access.company(cid, uid, 'VIEW');
    send(res, await this.stickers.fleetSheet(cid, q.size ?? 'a6', uid));
  }

  @Get('companies/:cid/notifications')
  notifications(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.notifications(cid, uid); }

  @Post('companies/:cid/notifications/read')
  markRead(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.markNotificationsRead(cid, uid); }

  // ---- buses ----

  @Get('buses/:id')
  bus(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.fleet.bus(id, uid); }

  @Patch('buses/:id')
  updateBus(@Param('id') id: string, @Body() dto: UpdateBusDto, @CurrentUser('id') uid: string) {
    return this.fleet.updateBus(id, dto, uid);
  }

  @Patch('buses/:id/archive')
  archiveBus(@Param('id') id: string, @Body() dto: ArchiveBusDto, @CurrentUser('id') uid: string) {
    return this.fleet.archiveBus(id, dto.archived, uid);
  }

  @Delete('buses/:id')
  deleteBus(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.fleet.deleteBus(id, uid); }

  @Get('buses/:id/qr')
  busQr(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.fleet.busQr(id, uid); }

  @Post('buses/:id/qr/rotate')
  rotateBusQr(@Param('id') id: string, @CurrentUser('id') uid: string, @Ip() ip: string) { return this.fleet.rotateBusQr(id, uid, ip); }

  /** The bus's sticker as a print-ready PDF (A6 or seat-back), or the code alone as PNG or SVG. */
  @Throttle({ default: { limit: 60, ttl: 600_000 } })
  @Get('buses/:id/qr/sticker')
  async busSticker(@Param('id') id: string, @Query() q: StickerQueryDto, @CurrentUser('id') uid: string, @Res() res: Response) {
    await this.access.bus(id, uid, 'VIEW');
    send(res, await this.stickers.busFile(id, q.format ?? 'pdf', q.size ?? 'a6', uid));
  }

  @Get('buses/:id/history')
  history(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.history(id, uid); }

  @Get('buses/:id/maintenance')
  maintenance(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.maintenance(id, uid); }

  @Post('buses/:id/maintenance')
  addMaintenance(@Param('id') id: string, @Body() dto: MaintenanceDto, @CurrentUser('id') uid: string) {
    return this.records.addMaintenance(id, dto, uid);
  }

  @Get('buses/:id/incidents')
  incidents(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.incidents(id, uid); }

  @Post('buses/:id/incidents')
  reportIncident(@Param('id') id: string, @Body() dto: IncidentDto, @CurrentUser('id') uid: string) {
    return this.records.reportIncident(id, dto, uid);
  }

  @Get('buses/:id/documents')
  documents(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.documents(id, uid); }

  @Post('buses/:id/documents')
  addDocument(@Param('id') id: string, @Body() dto: DocumentDto, @CurrentUser('id') uid: string) {
    return this.records.addDocument(id, dto, uid);
  }

  @Get('buses/:id/fuel')
  fuel(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.fuel(id, uid); }

  @Post('buses/:id/fuel')
  addFuel(@Param('id') id: string, @Body() dto: FuelDto, @CurrentUser('id') uid: string) {
    return this.records.addFuel(id, dto, uid);
  }

  @Get('buses/:id/crew')
  crew(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.crew(id, uid); }

  @Post('buses/:id/crew')
  assign(@Param('id') id: string, @Body() dto: AssignDriverDto, @CurrentUser('id') uid: string) {
    return this.records.assign(id, dto.driverId, uid);
  }

  @Delete('buses/:id/crew/:driverId')
  unassign(@Param('id') id: string, @Param('driverId') driverId: string, @CurrentUser('id') uid: string) {
    return this.records.unassign(id, driverId, uid);
  }

  // ---- individual records ----

  @Patch('maintenance/:id')
  updateMaintenance(@Param('id') id: string, @Body() dto: MaintenanceDto, @CurrentUser('id') uid: string) {
    return this.records.updateMaintenance(id, dto, uid);
  }

  @Delete('maintenance/:id')
  deleteMaintenance(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.deleteMaintenance(id, uid); }

  @Patch('incidents/:id/resolve')
  resolveIncident(@Param('id') id: string, @Body() dto: ResolveIncidentDto, @CurrentUser('id') uid: string) {
    return this.records.resolveIncident(id, dto, uid);
  }

  @Patch('documents/:id')
  updateDocument(@Param('id') id: string, @Body() dto: DocumentDto, @CurrentUser('id') uid: string) {
    return this.records.updateDocument(id, dto, uid);
  }

  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.deleteDocument(id, uid); }

  @Patch('drivers/:id')
  updateDriver(@Param('id') id: string, @Body() dto: DriverDto, @CurrentUser('id') uid: string) {
    return this.records.updateDriver(id, dto, uid);
  }

  @Delete('fuel/:id')
  deleteFuel(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.records.deleteFuel(id, uid); }

  @Post('reviews/:id/reply')
  reply(@Param('id') id: string, @Body() dto: ReplyDto, @CurrentUser('id') uid: string) {
    return this.reviews.reply(id, dto.reply, uid);
  }

  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('reviews/:id/report')
  reportReview(@Param('id') id: string, @Body() dto: OwnerReportDto, @CurrentUser('id') uid: string, @Ip() ip: string) {
    return this.reviews.report(id, dto, uid, ip);
  }
}
