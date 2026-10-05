import { CallHandler, ExecutionContext, Global, Injectable, Logger, Module, NestInterceptor, SetMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { tap } from 'rxjs';

/**
 * Tells the public website (bato-site) to drop its cached pages when something it shows
 * has changed: an article published or edited, an ad or partner package, a guide, a
 * listing. Fire and forget: the site's pages also expire on their own within minutes, so
 * a missed call only delays a change, never loses one.
 */
@Injectable()
export class SitePurgeService {
  private readonly log = new Logger(SitePurgeService.name);
  constructor(private config: ConfigService) {}

  purge(reason: string): void {
    const base = this.config.get<string>('SITE_URL');
    const key = this.config.get<string>('SITE_API_KEY');
    if (!base || !key) return;
    const at = String(Date.now());
    const signature = createHmac('sha256', key).update(`purge\n${at}`).digest('hex');
    fetch(`${base.replace(/\/$/, '')}/_purge`, {
      method: 'POST',
      headers: { 'x-purge-at': at, 'x-purge-signature': signature, 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(3000),
    }).catch((e) => this.log.warn(`Site purge failed (${reason}): ${(e as Error).message}`));
  }
}

const PURGE_SITE = 'purgeSite';
/** Marks a route whose success changes what the public website shows. */
export const PurgeSite = () => SetMetadata(PURGE_SITE, true);

@Injectable()
export class SitePurgeInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector, private purge: SitePurgeService) {}
  intercept(ctx: ExecutionContext, next: CallHandler) {
    const marked = this.reflector.get<boolean>(PURGE_SITE, ctx.getHandler());
    return next.handle().pipe(tap(() => { if (marked) this.purge.purge(`${ctx.getClass().name}.${ctx.getHandler().name}`); }));
  }
}

@Global()
@Module({
  providers: [SitePurgeService, { provide: APP_INTERCEPTOR, useClass: SitePurgeInterceptor }],
  exports: [SitePurgeService],
})
export class SitePurgeModule {}
