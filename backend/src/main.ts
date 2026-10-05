import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { JsonLogger } from './common/logging/json-logger';
import { initSentry } from './common/logging/sentry';

async function bootstrap() {
  // Error tracking only when SENTRY_DSN is set; personal data is scrubbed either way.
  initSentry();
  // Redacted, and one JSON object per line in production (common/logging).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: new JsonLogger() });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const isProd = config.get('NODE_ENV') === 'production';
  const { prefix, origins } = configureApp(app);

  app.enableShutdownHooks();

  const port = Number(config.get('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Health check at http://localhost:${port}/health`);
  logger.log(`CORS origins: ${origins.join(', ')}`);
  if (!isProd) logger.warn('Development mode — login codes are returned in API responses.');
}

bootstrap();
