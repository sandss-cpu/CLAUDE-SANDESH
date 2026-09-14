import { Module } from '@nestjs/common';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';
import { SmsService } from '../auth/sms.service';

@Module({ controllers: [SafetyController], providers: [SafetyService, SmsService] })
export class SafetyModule {}
