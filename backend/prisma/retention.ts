/**
 * Runs the 13-month retention now, instead of waiting for the nightly job.
 *   npm run retention
 */
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { RetentionService } from '../src/modules/retention/retention.service';

const prisma = new PrismaClient();
new RetentionService(prisma as never).run()
  .then((r) => { Logger.log(JSON.stringify(r), 'Retention'); })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
