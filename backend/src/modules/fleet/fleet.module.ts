import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FleetController } from './fleet.controller';
import { BusesController } from './buses.controller';
import { FleetAdminController } from './fleet-admin.controller';
import { FleetAccessService } from './fleet-access.service';
import { FleetService } from './fleet.service';
import { FleetRecordsService } from './fleet-records.service';
import { BusReviewsService } from './bus-reviews.service';
import { FleetAdminService } from './fleet-admin.service';
import { FleetRemindersTask } from './fleet-reminders.task';
import { TripsService } from './trips.service';

@Module({
  imports: [
    AuthModule,
    ModerationModule,
    // Signs scan tokens with the API secret; JwtStrategy rejects their scope as a session.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [BusesController, FleetAdminController, FleetController],
  providers: [
    FleetAccessService, FleetService, FleetRecordsService, BusReviewsService, FleetAdminService, FleetRemindersTask,
    TripsService,
  ],
  exports: [BusReviewsService, TripsService],
})
export class FleetModule {}
