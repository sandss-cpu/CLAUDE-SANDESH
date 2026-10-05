import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

@Injectable()
export class RetentionTask {
  constructor(private retention: RetentionService) {}

  /** 03:30 Kathmandu, when the buses are parked and the database is quiet. */
  @Cron('30 3 * * *', { name: 'retention', timeZone: 'Asia/Kathmandu' })
  nightly() {
    return this.retention.run();
  }
}
