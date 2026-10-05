import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PartnerAreaController, SiteAdminController, SiteController } from './site.controller';
import { SiteKeyGuard } from './site-key.guard';
import { SiteService } from './site.service';

@Module({
  imports: [AuthModule],
  controllers: [SiteController, PartnerAreaController, SiteAdminController],
  providers: [SiteService, SiteKeyGuard],
})
export class SiteModule {}
