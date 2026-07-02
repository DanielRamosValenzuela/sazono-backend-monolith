import 'dotenv/config';

import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { startTelemetry } from './common/observability/tracing';

async function bootstrap() {
  await startTelemetry();

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));
  app.flushLogs();
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;
  const apiPrefix = configService.get<string>('API_PREFIX') ?? 'api';
  const swaggerEnabled = configService.get<boolean>('SWAGGER_ENABLED') ?? true;
  const corsEnabled = configService.get<boolean>('CORS_ENABLED') ?? true;
  const corsOrigin = configService.get<string>('CORS_ORIGIN') ?? '*';

  if (corsEnabled) {
    const origin =
      corsOrigin === '*'
        ? true
        : corsOrigin
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);

    app.enableCors({
      origin,
      credentials: true,
    });
  }

  app.setGlobalPrefix(apiPrefix, {
    exclude: [{ path: '', method: RequestMethod.GET }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Sazono API')
      .setDescription(
        'Backend operativo de Sazono para salon, carta, ordenes, cocina y pagos.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  await app.listen(port);
  Logger.log(`HTTP server listening on port ${port}`, 'Bootstrap');
}
void bootstrap();
