import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AllConfigType } from '../config/config.type';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis | null = null;
  private isEnabled = false;

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  onModuleInit() {
    try {
      const redisUrl = this.configService.get('redis.url', { infer: true });
      const host = this.configService.get('redis.host', { infer: true });
      const port = this.configService.get('redis.port', { infer: true });
      const password = this.configService.get('redis.password', {
        infer: true,
      });
      const enabled =
        this.configService.get('redis.enabled', { infer: true }) ?? false;

      if (!enabled && !redisUrl) {
        this.logger.warn(
          '⚠️ [RedisCache] Redis is disabled or unconfigured. Falling back to DB-only mode.',
        );
        return;
      }

      const options = {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy(times: number) {
          if (times > 3) return null;
          return Math.min(times * 1000, 3000);
        },
      };

      if (redisUrl) {
        this.client = new Redis(redisUrl, options);
      } else {
        this.client = new Redis({
          host: host || 'localhost',
          port: port || 6379,
          password: password || undefined,
          ...options,
        });
      }

      this.client.on('error', (err) => {
        this.logger.warn(`⚠️ [RedisCache] Redis error: ${err.message}`);
      });

      this.client
        .connect()
        .then(() => {
          this.isEnabled = true;
          this.logger.log(
            '✅ [RedisCache] Connected to Redis Cache server successfully.',
          );
        })
        .catch((err) => {
          this.logger.warn(
            `⚠️ [RedisCache] Could not connect to Redis (${err.message}). Caching disabled.`,
          );
          this.isEnabled = false;
        });
    } catch (err) {
      this.logger.warn(
        `⚠️ [RedisCache] Initialization error: ${(err as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.isEnabled || !this.client) return null;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      this.logger.debug(
        `[RedisCache] Get failed for key ${key}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: any, ttlSeconds: number = 60): Promise<void> {
    if (!this.isEnabled || !this.client) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      this.logger.debug(
        `[RedisCache] Set failed for key ${key}: ${(error as Error).message}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isEnabled || !this.client) return;
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.debug(
        `[RedisCache] Del failed for key ${key}: ${(error as Error).message}`,
      );
    }
  }

  delByPattern(pattern: string): Promise<void> {
    if (!this.isEnabled || !this.client) return Promise.resolve();
    return new Promise<void>((resolve) => {
      try {
        const stream = this.client!.scanStream({
          match: pattern,
          count: 100,
        });
        stream.on('data', async (keys: string[]) => {
          if (keys.length > 0 && this.client) {
            const pipeline = this.client.pipeline();
            keys.forEach((key) => pipeline.del(key));
            await pipeline.exec();
          }
        });
        stream.on('end', () => resolve());
        stream.on('error', (err) => {
          this.logger.debug(
            `[RedisCache] delByPattern error for pattern ${pattern}: ${err.message}`,
          );
          resolve();
        });
      } catch (error) {
        this.logger.debug(
          `[RedisCache] delByPattern failed for pattern ${pattern}: ${(error as Error).message}`,
        );
        resolve();
      }
    });
  }
}
