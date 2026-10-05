import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Everything about how the API answers that is not a module: the /api/v1 prefix, the
 * client address behind Render's proxy, security headers, CORS and validation. Shared by
 * main.ts and the end-to-end tests, so the tests run the API exactly as it is served.
 */
export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const prefix = config.get<string>('API_PREFIX') ?? 'api/v1';

  app.setGlobalPrefix(prefix, { exclude: ['health'] });

  /**
   * Behind a hosting proxy (Render) every request arrives from the proxy's
   * address. Without this, rate limits are shared by all visitors and every
   * anonymous report counts as the same person. It is a hop count rather than
   * `true`, because trusting X-Forwarded-For with no proxy in front would let
   * any client choose its own IP.
   */
  const proxyHops = Number(config.get('TRUST_PROXY') ?? 0);
  if (proxyHops > 0) {
    app.set('trust proxy', proxyHops);
    logger.log(`Client IPs taken from ${proxyHops} trusted proxy hop(s)`);
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Uploads are served from /static. If content sniffing ever mistakes an
      // upload for HTML, this stops it executing anything.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'none'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  /**
   * No wildcard fallback. A permissive default combined with credentials
   * would let any site on the internet make authenticated calls on behalf
   * of a signed-in user. In production this list is mandatory and validated
   * at startup; in development it defaults to the local front end only.
   */
  const configured = config.get<string>('CORS_ORIGINS');
  const origins = configured
    ? configured.split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  return { prefix, origins };
}
