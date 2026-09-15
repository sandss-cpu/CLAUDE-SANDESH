import { Module } from '@nestjs/common';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { FleetModule } from '../fleet/fleet.module';

@Module({ imports: [FleetModule], controllers: [QrController], providers: [QrService], exports: [QrService] })
export class QrModule {}
