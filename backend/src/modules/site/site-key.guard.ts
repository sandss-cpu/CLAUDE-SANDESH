import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

/**
 * The public website's forms reach these routes only through the site's own server, which
 * proves itself with SITE_API_KEY and passes on the visitor's address (x-site-client-ip)
 * for rate limits and the hashed log. Without the key there is nothing to post to.
 */
@Injectable()
export class SiteKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const expected = Buffer.from(this.config.get<string>('SITE_API_KEY') ?? '');
    const given = Buffer.from(String(req.headers['x-site-key'] ?? ''));
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new ForbiddenException('Only the Batoma website can post here.');
    }
    req.siteClientIp = String(req.headers['x-site-client-ip'] ?? '').slice(0, 64) || req.ip;
    return true;
  }
}
