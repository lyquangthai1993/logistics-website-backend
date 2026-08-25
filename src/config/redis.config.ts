import { registerAs } from '@nestjs/config';
import { RedisConfig } from './redis-config.type';
import validateConfig from '../utils/validate-config';
import {
  IsBooleanString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  REDIS_URL: string;

  @IsString()
  @IsOptional()
  REDIS_HOST: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  REDIS_PORT: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD: string;

  @IsBooleanString()
  @IsOptional()
  REDIS_ENABLED: string;
}

export default registerAs<RedisConfig>('redis', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  const rawUrl = process.env.REDIS_URL?.trim();
  const rawHost = process.env.REDIS_HOST?.trim();
  const isExplicitlyDisabled = process.env.REDIS_ENABLED === 'false';
  const hasConfig = Boolean(rawUrl || rawHost);

  return {
    url: rawUrl || undefined,
    host: rawHost || 'localhost',
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    enabled: hasConfig && !isExplicitlyDisabled,
  };
});
