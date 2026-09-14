import { Module } from '@nestjs/common';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { SubscriptionsTask } from './subscriptions.task';
import { SmsService } from '../auth/sms.service';

@Module({
  controllers: [BusinessesController],
  providers: [BusinessesService, SubscriptionsTask, SmsService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
