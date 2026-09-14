import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefix = config.get<string>('API_PREFIX') ?? 'api/v1';
  const isProd = config.get('NODE_ENV') === 'production';

  app.setGlobalPrefix(prefix, { exclude: ['health'] });

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
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
      // Do not leak validation internals to the client in production.
      disableErrorMessages: isProd === true && false,
    }),
  );

  app.enableShutdownHooks();

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Health check at http://localhost:${port}/health`);
  logger.log(`CORS origins: ${origins.join(', ')}`);
  if (!isProd) logger.warn('Development mode — login codes are returned in API responses.');
}

bootstrap();
