import * as Sentry from '@sentry/node';
import { redact, redactDeep } from './redact';

/**
 * Error tracking, only when SENTRY_DSN is set. Nothing personal leaves the server:
 * no IP addresses, cookies, headers or request bodies, no user beyond an id, and every
 * message and breadcrumb passes through the same redaction as the logs.
 */
let enabled = false;

export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
    release: env.RENDER_GIT_COMMIT || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => ({ ...crumb, message: crumb.message ? redact(crumb.message) : crumb.message, data: crumb.data ? redactDeep(crumb.data) : crumb.data }),
  });
  enabled = true;
  return true;
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    event.request = { method: event.request.method, url: event.request.url ? redact(event.request.url.split('?')[0]) : undefined };
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  if (event.message) event.message = redact(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = redact(ex.value);
  if (event.extra) event.extra = redactDeep(event.extra);
  if (event.contexts) event.contexts = redactDeep(event.contexts);
  delete (event as { server_name?: string }).server_name;
  return event;
}

export function reportError(error: unknown, ctx: { method?: string; path?: string; userId?: string } = {}) {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.method) scope.setTag('method', ctx.method);
    if (ctx.path) scope.setTag('path', redact(ctx.path.split('?')[0]));
    Sentry.captureException(error);
  });
}
