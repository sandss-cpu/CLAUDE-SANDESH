import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Keeps raw activity for 13 months, then only what is needed to count it.
 *
 * - Scans (bus code, time, device session, address hash): rolled up into daily counts
 *   per code (`scan_daily`), then deleted.
 * - Website page views, impressions and clicks: rolled up into daily counts per partner,
 *   ad and story (`site_event_daily`), then deleted. Partner reports read both.
 * - Address hashes on reviews, reports, enquiries, newsletter sign-ups and the audit
 *   log: cleared. The rows stay; who sent them from where does not.
 * - Browsers not seen for 13 months are forgotten; spent sign-in counters are removed.
 *
 * The cut-off is the start of a Kathmandu day, so each day is rolled up once, whole.
 */
export const RETENTION_MONTHS = 13;

/** Midnight in Kathmandu, 13 calendar months before `now`, as a UTC instant. */
export function retentionCutoff(now: Date): Date {
  const ktm = new Date(now.getTime() + 345 * 60_000);
  const day = Date.UTC(ktm.getUTCFullYear(), ktm.getUTCMonth() - RETENTION_MONTHS, ktm.getUTCDate());
  return new Date(day - 345 * 60_000);
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  constructor(private prisma: PrismaService) {}

  async run(now = new Date()) {
    const cutoff = retentionCutoff(now);
    const result = await this.prisma.$transaction(async (tx) => {
      // One run at a time, across API instances: two at once would count the same rows twice.
      const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(4207150013) AS locked`;
      if (!locked) return null;
      const scansRolled = await tx.$executeRaw`
        INSERT INTO scan_daily (day, "qrCodeId", scans, "firstScans", sessions)
        SELECT ("scannedAt" + interval '345 minutes')::date, "qrCodeId", count(*), count(*) FILTER (WHERE "isFirstScan"), count(DISTINCT "sessionId")
        FROM scan_events WHERE "scannedAt" < ${cutoff} GROUP BY 1, 2
        ON CONFLICT (day, "qrCodeId") DO UPDATE SET
          scans = scan_daily.scans + EXCLUDED.scans, "firstScans" = scan_daily."firstScans" + EXCLUDED."firstScans",
          sessions = scan_daily.sessions + EXCLUDED.sessions`;
      const scansDeleted = await tx.$executeRaw`DELETE FROM scan_events WHERE "scannedAt" < ${cutoff}`;
      const eventsRolled = await tx.$executeRaw`
        INSERT INTO site_event_daily (day, type, target, "businessId", "adId", "articleId", count)
        SELECT ("createdAt" + interval '345 minutes')::date, type, target, "businessId", "adId", "articleId", count(*)
        FROM site_events WHERE "createdAt" < ${cutoff} GROUP BY 1, 2, 3, 4, 5, 6
        ON CONFLICT (day, type, COALESCE(target, ''), COALESCE("businessId", ''), COALESCE("adId", ''), COALESCE("articleId", ''))
        DO UPDATE SET count = site_event_daily.count + EXCLUDED.count`;
      const eventsDeleted = await tx.$executeRaw`DELETE FROM site_events WHERE "createdAt" < ${cutoff}`;
      let hashesCleared = 0;
      hashesCleared += await tx.$executeRaw`UPDATE ride_feedback SET "ipHash" = NULL WHERE "ipHash" IS NOT NULL AND "createdAt" < ${cutoff}`;
      hashesCleared += await tx.$executeRaw`UPDATE reports SET "ipHash" = NULL WHERE "ipHash" IS NOT NULL AND "createdAt" < ${cutoff}`;
      hashesCleared += await tx.$executeRaw`UPDATE site_enquiries SET "ipHash" = NULL WHERE "ipHash" IS NOT NULL AND "createdAt" < ${cutoff}`;
      hashesCleared += await tx.$executeRaw`UPDATE newsletter_subscribers SET "ipHash" = NULL WHERE "ipHash" IS NOT NULL AND "createdAt" < ${cutoff}`;
      hashesCleared += await tx.$executeRaw`UPDATE audit_events SET "ipHash" = NULL WHERE "ipHash" IS NOT NULL AND "createdAt" < ${cutoff}`;
      const devicesForgotten = await tx.$executeRaw`DELETE FROM known_devices WHERE "lastSeenAt" < ${cutoff}`;
      const guardsCleared = await tx.$executeRaw`
        DELETE FROM login_guards WHERE "lastFailureAt" < ${new Date(now.getTime() - 86_400_000)} AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})`;
      return { cutoff: cutoff.toISOString(), scansRolled, scansDeleted, eventsRolled, eventsDeleted, hashesCleared, devicesForgotten, guardsCleared };
    }, { timeout: 120_000 });
    if (!result) { this.logger.log('Retention skipped: another instance is running it.'); return null; }
    this.logger.log(`Retention up to ${result.cutoff}: ${result.scansDeleted} scans and ${result.eventsDeleted} website events rolled up, ${result.hashesCleared} address hashes cleared, ${result.devicesForgotten} devices forgotten.`);
    return result;
  }
}
