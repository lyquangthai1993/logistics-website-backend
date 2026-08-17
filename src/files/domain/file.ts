import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';
import { Transform } from 'class-transformer';
import fileConfig from '../config/file.config';
import { FileConfig, FileDriver } from '../config/file-config.type';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../config/app-config.type';
import appConfig from '../../config/app.config';

export class FileType {
  @ApiProperty({
    type: String,
    example: 'cbcfa8b8-3a25-4adb-a9c6-e325f0d0f3ae',
  })
  @Allow()
  id: string;

  @ApiProperty({
    type: String,
    example: 'https://example.com/path/to/file.jpg',
  })
  @Transform(
    ({ value }) => {
      const config = fileConfig() as FileConfig;

      if (config.driver === FileDriver.LOCAL) {
        // Local: prepend backend domain
        return (appConfig() as AppConfig).backendDomain + value;
      }

      if ([FileDriver.S3, FileDriver.S3_PRESIGNED].includes(config.driver)) {
        // ── Public bucket (Supabase, R2 public, MinIO public) ──────────
        // If AWS_S3_PUBLIC_URL is set, construct a permanent public URL.
        // Supabase format: https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<key>
        if (config.awsS3PublicUrl) {
          return `${config.awsS3PublicUrl.replace(/\/$/, '')}/${value}`;
        }

        // ── Private bucket fallback ────────────────────────────────────
        // Generate a presigned URL that expires in 1 hour.
        const endpoint = config.awsS3Endpoint;
        const s3 = new S3Client({
          region: config.awsS3Region ?? '',
          credentials: {
            accessKeyId: config.accessKeyId ?? '',
            secretAccessKey: config.secretAccessKey ?? '',
          },
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        });

        const command = new GetObjectCommand({
          Bucket: config.awsDefaultS3Bucket ?? '',
          Key: value,
        });

        return getSignedUrl(s3, command, { expiresIn: 3600 });
      }

      return value;
    },
    {
      toPlainOnly: true,
    },
  )
  path: string;
}
