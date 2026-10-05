import { Module } from '@nestjs/common';
import { StorageModule } from '../../common/storage/storage.module';
import { FleetModule } from '../fleet/fleet.module';
import { AdminDocumentsController, BusinessDocumentsController, CompanyDocumentsController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [StorageModule, FleetModule],
  controllers: [CompanyDocumentsController, BusinessDocumentsController, AdminDocumentsController],
  providers: [VerificationService],
})
export class VerificationModule {}
