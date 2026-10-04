import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { FleetModule } from '../fleet/fleet.module';
import { ProgrammingModule } from '../programming/programming.module';

@Module({ imports: [FleetModule, ProgrammingModule], controllers: [QrController], providers: [QrService], exports: [QrService] })
export class QrModule {}
