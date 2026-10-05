import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { config } from './config';
import { clientIp } from './events';

/**
 * Public forms, without JavaScript and without cookies. Each one carries a hidden field
 * people never see (bots fill it) and a time token stamped when the page was served:
 * a form sent back within seconds was not filled in by a person, and one older than a day
 * is stale. The site forwards what passes to the API with its own key.
 */

const secret = () => config.apiKey || 'dev-form-secret';
const sign = (at: string) => createHmac('sha256', secret()).update(`form\n${at}`).digest('hex').slice(0, 32);
const MIN_MS = 3000;
const MAX_MS = 24 * 3600_000;

export const formToken = (at = Date.now()) => `${at.toString(36)}.${sign(at.toString(36))}`;

export type GuardResult = 'ok' | 'bot' | 'stale';

export function checkGuards(body: Record<string, unknown>, now = Date.now()): GuardResult {
  if (String(body.website ?? '').trim()) return 'bot';
  const [at, sig] = String(body.t ?? '').split('.');
  if (!at || !sig || sig.length !== 32) return 'stale';
  const given = Buffer.from(sig);
  const expected = Buffer.from(sign(at));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'stale';
  const age = now - parseInt(at, 36);
  if (!(age >= 0)) return 'stale';
  if (age < MIN_MS) return 'bot';
  return age > MAX_MS ? 'stale' : 'ok';
}

/** Ten form posts per address per ten minutes; plenty for a person, a wall for a script. */
const LIMIT = 10;
const WINDOW_MS = 10 * 60_000;
const hits = new Map<string, { n: number; since: number }>();

export function overLimit(req: Request, now = Date.now()): boolean {
  const key = clientIp(req);
  const h = hits.get(key);
  if (!h || now - h.since > WINDOW_MS) {
    hits.set(key, { n: 1, since: now });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.since > WINDOW_MS) hits.delete(k);
    return false;
  }
  h.n += 1;
  return h.n > LIMIT;
}
export const resetLimits = () => hits.clear();

/** Only the named fields, as trimmed strings, so nothing else reaches the API. */
export function pick(body: Record<string, unknown>, names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, String(body[n] ?? '').trim().slice(0, 4000)]));
}

export interface Forwarded { ok: boolean; status: number; message?: string; data?: Record<string, unknown> }

export async function forward(path: string, body: Record<string, unknown>, req: Request): Promise<Forwarded> {
  try {
    const res = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-site-key': config.apiKey, 'x-site-client-ip': clientIp(req) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const answer = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // The API wraps answers as { success, data }.
    const data = (answer.data ?? answer) as Record<string, unknown>;
    if (res.ok) return { ok: true, status: res.status, data };
    const message = res.status === 429
      ? 'Too many messages just now. Please try again in a few minutes.'
      : res.status >= 500 || res.status === 403
        ? 'We could not send that just now. Please try again in a minute.'
        : String(answer.message ?? 'Please check the form and try again.');
    return { ok: false, status: res.status, message };
  } catch (e) {
    console.error(`forward ${path} failed:`, (e as Error).message);
    return { ok: false, status: 503, message: 'We could not send that just now. Please try again in a minute.' };
  }
}
