import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Where a request came from: the client's address (behind TRUST_PROXY hops) and its browser. */
export const ClientContext = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip ?? null, userAgent: String(req.headers?.['user-agent'] ?? '').slice(0, 400) || null };
});
