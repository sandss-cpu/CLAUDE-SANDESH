import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FleetService } from './fleet.service';
import { FleetRecordsService } from './fleet-records.service';
import { BusReviewsService } from './bus-reviews.service';
import {
  AddMemberDto, ArchiveBusDto, AssignDriverDto, BusListQueryDto, CreateBusDto, CreateCompanyDto, DocumentDto,
  DriverDto, FuelDto, IncidentDto, MaintenanceDto, OwnerReportDto, ReplyDto, ResolveIncidentDto,
  ReviewListQueryDto, UpdateBusDto, UpdateCompanyDto,
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
  ) {}

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
  rotateCompanyQr(@Param('cid') cid: string, @CurrentUser('id') uid: string) { return this.fleet.rotateCompanyQr(cid, uid); }

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
  rotateBusQr(@Param('id') id: string, @CurrentUser('id') uid: string) { return this.fleet.rotateBusQr(id, uid); }

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
