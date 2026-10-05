import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RetentionTask } from './retention.task';

@Module({ providers: [RetentionService, RetentionTask], exports: [RetentionService] })
export class RetentionModule {}
