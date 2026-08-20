import { registerAs } from '@nestjs/config';

import {
  IsString,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import validateConfig from '../../utils/validate-config';
import { MailConfig } from './mail-config.type';

class EnvironmentVariablesValidator {
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseInt(value, 10) : undefined,
  )
  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  MAIL_PORT?: number;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  MAIL_HOST?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  MAIL_USER?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  MAIL_PASSWORD?: string;

  @Transform(({ value }) => (value ? String(value).trim() : undefined))
  @ValidateIf((e) => !!e.MAIL_DEFAULT_EMAIL)
  @IsEmail()
  @IsOptional()
  MAIL_DEFAULT_EMAIL?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  MAIL_DEFAULT_NAME?: string;

  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  @IsOptional()
  MAIL_IGNORE_TLS?: boolean;

  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  @IsOptional()
  MAIL_SECURE?: boolean;

  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  @IsOptional()
  MAIL_REQUIRE_TLS?: boolean;

  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  @IsOptional()
  MAIL_SIMULATE?: boolean;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  MAIL_RESEND_API_KEY?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  RESEND_API_KEY?: string;
}

export default registerAs<MailConfig>('mail', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    port: process.env.MAIL_PORT ? parseInt(process.env.MAIL_PORT, 10) : 587,
    host: process.env.MAIL_HOST,
    user: process.env.MAIL_USER,
    password: process.env.MAIL_PASSWORD,
    defaultEmail: process.env.MAIL_DEFAULT_EMAIL || 'onboarding@resend.dev',
    defaultName: process.env.MAIL_DEFAULT_NAME || 'Spider Express Logistics',
    ignoreTLS: process.env.MAIL_IGNORE_TLS === 'true',
    secure: process.env.MAIL_SECURE === 'true',
    requireTLS: process.env.MAIL_REQUIRE_TLS === 'true',
    simulate: process.env.MAIL_SIMULATE === 'true',
    resendApiKey: process.env.MAIL_RESEND_API_KEY || process.env.RESEND_API_KEY,
  };
});
