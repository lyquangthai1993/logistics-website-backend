import 'dotenv/config';
import { types } from 'pg';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Force node-postgres (pg) to parse TIMESTAMP WITHOUT TIME ZONE (OID 1114) as UTC Date.
// In PostgreSQL (Neon), timestamps are stored in UTC (GMT). Without this parser override,
// pg parses the timestamp string in the server host machine's local timezone (e.g. UTC+7),
// which causes a negative timezone offset shift when serialized to ISO string (JSON).
types.setTypeParser(1114, (stringValue: string) => {
  if (!stringValue) return null;
  const isoString = stringValue.includes('T') ? stringValue : stringValue.replace(' ', 'T');
  return new Date(isoString.endsWith('Z') ? isoString : `${isoString}Z`);
});

import {
  ClassSerializerInterceptor,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import validationOptions from './utils/validation-options';
import { AllConfigType } from './config/config.type';
import { ResolvePromisesInterceptor } from './utils/serializer.interceptor';
import { isCorsOriginAllowed } from './utils/cors-origin.validator';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  const configService = app.get(ConfigService<AllConfigType>);

  // Enable Socket.IO WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  const nodeEnv = configService.get('app.nodeEnv', { infer: true });
  const isDev =
    nodeEnv !== 'production' ||
    process.env.RENDER_GIT_BRANCH === 'dev' ||
    process.env.RENDER_GIT_BRANCH === 'development';

  const corsOrigins = configService.getOrThrow('app.corsOrigins', {
    infer: true,
  });

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      const isAllowed = isCorsOriginAllowed(origin, corsOrigins, isDev);
      if (isAllowed) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Requested-With',
      'x-custom-lang',
      'sentry-trace',
      'baggage',
      'Cache-Control',
      'Pragma',
      'X-Refresh-Token',
    ],
    exposedHeaders: ['X-Refresh-Token', 'Content-Disposition'],
  });

  app.enableShutdownHooks();
  app.setGlobalPrefix(
    configService.getOrThrow('app.apiPrefix', { infer: true }),
    {
      exclude: ['/'],
    },
  );
  app.enableVersioning({
    type: VersioningType.URI,
  });
  app.useGlobalPipes(new ValidationPipe(validationOptions));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    // ResolvePromisesInterceptor is used to resolve promises in responses because class-transformer can't do it
    // https://github.com/typestack/class-transformer/issues/549
    new ResolvePromisesInterceptor(),
    new ResponseTransformInterceptor(app.get(Reflector)),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  const options = new DocumentBuilder()
    .setTitle('API')
    .setDescription('API docs')
    .setVersion('1.0')
    .addBearerAuth()
    .addGlobalParameters({
      in: 'header',
      required: false,
      name: process.env.APP_HEADER_LANGUAGE || 'x-custom-lang',
      schema: {
        example: 'en',
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = configService.getOrThrow('app.port', { infer: true });
  await app.listen(port, '0.0.0.0');
  console.log(
    `🚀 Application is running on: http://0.0.0.0:${port}/${configService.getOrThrow('app.apiPrefix', { infer: true })}`,
  );
}
void bootstrap();
