import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Failed sign-ins, counted per account and per address (hashed). The first few
 * mistakes cost nothing; after that each failure makes the next attempt wait longer,
 * up to a 15-minute lock. While locked, the password or code is not even checked, so
 * guessing gains nothing. An hour without failures starts the count again.
 *
 * The lock is short on purpose: anyone can type someone else's email, so a long lock
 * would let a stranger keep a person out of their own account. The address limit is
 * looser, because a school or a bus park shares one address.
 */
const ACCOUNT_WAITS_S = [0, 0, 0, 0, 30, 60, 120, 300, 900];
const IP_FREE = 30;
const IP_LOCK_S = 900;
const RESET_AFTER_MS = 3_600_000;

export interface GuardKeys { account: string; ip: string | null }

@Injectable()
export class LoginGuardService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Keys for an attempt: the account (or, if there is none, a hash of what was typed) and the address. */
  keys(account: { userId?: string | null; identifier?: string | null }, ip?: string | null): GuardKeys {
    const who = account.userId
      ? `acct:${account.userId}`
      : `acct:none:${createHash('sha256').update(String(account.identifier ?? '').toLowerCase()).digest('hex').slice(0, 32)}`;
    const addr = ip ? this.audit.hashIp(ip) : null;
    return { account: who, ip: addr ? `ip:${addr}` : null };
  }

  /** Refuses the attempt, without checking anything, while either key is locked. */
  async assertOpen(k: GuardKeys): Promise<void> {
    const rows = await this.prisma.loginGuard.findMany({
      where: { key: { in: [k.account, ...(k.ip ? [k.ip] : [])] }, lockedUntil: { gt: new Date() } },
      select: { lockedUntil: true },
    });
    if (!rows.length) return;
    const until = Math.max(...rows.map((r) => r.lockedUntil!.getTime()));
    const wait = Math.ceil((until - Date.now()) / 1000);
    throw new HttpException({
      code: 'SIGN_IN_LOCKED', retryAfterSeconds: wait,
      message: wait > 90
        ? `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minutes, or reset your password.`
        : `Too many failed attempts. Try again in ${wait} seconds.`,
    }, HttpStatus.TOO_MANY_REQUESTS);
  }

  async failed(k: GuardKeys, ctx: { userId?: string | null; what: string; ip?: string | null }): Promise<void> {
    const now = new Date();
    const count = async (key: string) => {
      const [row] = await this.prisma.$queryRaw<Array<{ failures: number }>>`
        INSERT INTO login_guards (key, failures, "firstFailureAt", "lastFailureAt") VALUES (${key}, 1, ${now}, ${now})
        ON CONFLICT (key) DO UPDATE SET
          failures = CASE WHEN login_guards."lastFailureAt" < ${new Date(now.getTime() - RESET_AFTER_MS)} THEN 1 ELSE login_guards.failures + 1 END,
          "firstFailureAt" = CASE WHEN login_guards."lastFailureAt" < ${new Date(now.getTime() - RESET_AFTER_MS)} THEN ${now} ELSE login_guards."firstFailureAt" END,
          "lastFailureAt" = ${now}
        RETURNING failures`;
      return row.failures;
    };
    const lock = (key: string, seconds: number) => this.prisma.loginGuard.update({ where: { key }, data: { lockedUntil: new Date(now.getTime() + seconds * 1000) } });

    const n = await count(k.account);
    const wait = ACCOUNT_WAITS_S[Math.min(n, ACCOUNT_WAITS_S.length) - 1];
    if (wait) await lock(k.account, wait);
    let ipLocked = false;
    if (k.ip) {
      const m = await count(k.ip);
      if (m >= IP_FREE) { await lock(k.ip, IP_LOCK_S); ipLocked = m === IP_FREE; }
    }
    await this.audit.record({
      actorId: null, action: 'auth.failed', entityType: 'User', entityId: ctx.userId ?? null, ip: ctx.ip,
      summary: `${ctx.what} failed${ctx.userId ? '' : ' (no such account)'}${wait ? `; next attempt in ${wait >= 60 ? `${wait / 60} min` : `${wait} s`}` : ''}`,
    });
    if (wait === ACCOUNT_WAITS_S[ACCOUNT_WAITS_S.length - 1] || ipLocked) {
      await this.audit.record({
        actorId: null, action: 'auth.locked', entityType: 'User', entityId: ctx.userId ?? null, ip: ctx.ip,
        summary: ipLocked ? 'Sign-in locked for an address after many failures' : 'Sign-in locked for 15 minutes after repeated failures',
      });
    }
  }

  /** A correct password or code clears the account's count (not the address's). */
  async succeeded(k: GuardKeys): Promise<void> {
    await this.prisma.loginGuard.deleteMany({ where: { key: k.account } });
  }
}
