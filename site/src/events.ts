import { createHash } from 'crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { config } from './config';
import { db } from './db';

/**
 * The site's own analytics: no cookies, nothing sent anywhere else. A visit is a salted
 * hash of address, browser and a 30-minute window, so the same person tomorrow is a new
 * visit and no row can be traced back to anyone. Bots and page tests are not counted.
 */
export type EventType = 'PAGE_VIEW' | 'IMPRESSION' | 'CLICK';
export interface SiteEventIn { type: EventType; path: string; target?: string | null; businessId?: string | null; adId?: string | null; articleId?: string | null }

const BOT = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|whatsapp|curl|wget|python|monitor/i;

export function clientIp(req: Request): string {
  return req.ip ?? '';
}

export function visitHash(req: Request, at = Date.now()): string {
  const window = Math.floor(at / (30 * 60_000));
  return createHash('sha256').update(`${clientIp(req)}|${req.get('user-agent') ?? ''}|${window}|${config.eventSalt}`).digest('hex').slice(0, 32);
}

export function isBot(req: Request) {
  return BOT.test(req.get('user-agent') ?? '');
}

function referrerHost(req: Request): string | null {
  try {
    const host = new URL(req.get('referer') ?? '').host;
    return host && !config.siteUrl.includes(host) ? host.slice(0, 120) : null;
  } catch { return null; }
}

/**
 * Plain INSERTs: the site's role may add rows but not read them back. A click repeated in
 * the same visit hits the partial unique index and is quietly dropped.
 */
export async function record(req: Request, events: SiteEventIn[]): Promise<void> {
  if (!events.length || isBot(req)) return;
  const hash = visitHash(req);
  const ref = referrerHost(req);
  try {
    await db.$executeRaw`
      INSERT INTO site_events (type, path, target, "businessId", "adId", "articleId", "sessionHash", "referrerHost")
      VALUES ${Prisma.join(events.map((e) => Prisma.sql`(${e.type}::"SiteEventType", ${e.path.slice(0, 300)}, ${e.target ?? null}, ${e.businessId ?? null}, ${e.adId ?? null}, ${e.articleId ?? null}, ${hash}, ${ref})`))}
      ON CONFLICT DO NOTHING`;
  } catch (e) {
    console.error('site event not recorded:', (e as Error).message);
  }
}
