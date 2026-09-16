import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { PrismaModule } from './common/prisma/prisma.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { QrModule } from './modules/qr/qr.module';
import { MagazineModule } from './modules/magazine/magazine.module';
import { PostsModule } from './modules/posts/posts.module';
import { EngagementModule } from './modules/engagement/engagement.module';
import { PlacesModule } from './modules/places/places.module';
import { ItinerariesModule } from './modules/itineraries/itineraries.module';
import { BusinessesModule } from './modules/businesses/businesses.module';
import { OperatorsModule } from './modules/operators/operators.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { SafetyModule } from './modules/safety/safety.module';
import { MediaModule } from './modules/media/media.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { AdsModule } from './modules/ads/ads.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { GuidesModule } from './modules/guides/guides.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { SettingsModule } from './modules/settings/settings.module';

@Module({
  imports: [
    // Refuses to start on an unsafe configuration rather than starting quietly.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // Drives the nightly subscription expiry job.
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
      serveRoot: '/static',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    QrModule,
    MagazineModule,
    PostsModule,
    EngagementModule,
    PlacesModule,
    ItinerariesModule,
    BusinessesModule,
    OperatorsModule,
    ModerationModule,
    SafetyModule,
    MediaModule,
    AdminModule,
    AdsModule,
    FleetModule,
    GuidesModule,
    CreatorsModule,
    SettingsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
