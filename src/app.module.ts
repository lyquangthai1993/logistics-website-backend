import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { HubsModule } from './hubs/hubs.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { DriversModule } from './drivers/drivers.module';
import { OrdersModule } from './orders/orders.module';
import { TripsModule } from './trips/trips.module';
import { FilesModule } from './files/files.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthModule } from './auth/auth.module';
import databaseConfig from './database/config/database.config';
import authConfig from './auth/config/auth.config';
import appConfig from './config/app.config';
import mailConfig from './mail/config/mail.config';
import fileConfig from './files/config/file.config';
import facebookConfig from './auth-facebook/config/facebook.config';
import googleConfig from './auth-google/config/google.config';
import appleConfig from './auth-apple/config/apple.config';
import redisConfig from './config/redis.config';
import path from 'path';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { AuthAppleModule } from './auth-apple/auth-apple.module';
import { AuthFacebookModule } from './auth-facebook/auth-facebook.module';
import { AuthGoogleModule } from './auth-google/auth-google.module';
import { HeaderResolver, I18nModule } from 'nestjs-i18n';
import { TypeOrmConfigService } from './database/typeorm-config.service';
import { MailModule } from './mail/mail.module';
import { HomeModule } from './home/home.module';
import { DataSource, DataSourceOptions } from 'typeorm';
import { AllConfigType } from './config/config.type';
import { SessionModule } from './session/session.module';
import { MailerModule } from './mailer/mailer.module';
import { MongooseModule } from '@nestjs/mongoose';
import { MongooseConfigService } from './database/mongoose-config.service';
import { DatabaseConfig } from './database/config/database-config.type';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// <database-block>
const infrastructureDatabaseModule = (databaseConfig() as DatabaseConfig)
  .isDocumentDatabase
  ? MongooseModule.forRootAsync({
      useClass: MongooseConfigService,
    })
  : TypeOrmModule.forRootAsync({
      useClass: TypeOrmConfigService,
      dataSourceFactory: async (options: DataSourceOptions) => {
        return new DataSource(options).initialize();
      },
    });
// </database-block>

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        appConfig,
        mailConfig,
        fileConfig,
        facebookConfig,
        googleConfig,
        appleConfig,
        redisConfig,
      ],
      envFilePath: ['.env'],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService<AllConfigType>) => {
        const redisUrl = configService.get('redis.url', { infer: true });
        const host = configService.get('redis.host', { infer: true });
        const port = configService.get('redis.port', { infer: true });
        const password = configService.get('redis.password', { infer: true });

        if (redisUrl) {
          return {
            connection: {
              url: redisUrl,
              maxRetriesPerRequest: null,
              enableReadyCheck: false,
              retryStrategy(times) {
                if (times > 3) return null;
                return Math.min(times * 1000, 3000);
              },
            },
          };
        }

        return {
          connection: {
            host: host || 'localhost',
            port: port || 6379,
            password: password || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            retryStrategy(times) {
              if (times > 3) return null;
              return Math.min(times * 1000, 3000);
            },
          },
        };
      },
      inject: [ConfigService],
    }),
    infrastructureDatabaseModule,
    I18nModule.forRootAsync({
      useFactory: (configService: ConfigService<AllConfigType>) => ({
        fallbackLanguage: configService.getOrThrow('app.fallbackLanguage', {
          infer: true,
        }),
        loaderOptions: { path: path.join(__dirname, '/i18n/'), watch: true },
      }),
      resolvers: [
        {
          use: HeaderResolver,
          useFactory: (configService: ConfigService<AllConfigType>) => {
            return [
              configService.get('app.headerLanguage', {
                infer: true,
              }),
            ];
          },
          inject: [ConfigService],
        },
      ],
      imports: [ConfigModule],
      inject: [ConfigService],
    }),
    UsersModule,
    FilesModule,
    AuthModule,
    AuthFacebookModule,
    AuthGoogleModule,
    AuthAppleModule,
    SessionModule,
    MailModule,
    MailerModule,
    HomeModule,
    HubsModule,
    VehiclesModule,
    DriversModule,
    OrdersModule,
    TripsModule,
    NotificationsModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 60 seconds
        limit: 100, // 100 requests per minute
      },
      {
        name: 'auth',
        ttl: 60000, // 60 seconds
        limit: process.env.NODE_ENV === 'development' ? 200 : 10,
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
