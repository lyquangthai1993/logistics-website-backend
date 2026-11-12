import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDraftMetricsToDailyRegionalDispatchReport1789140000000 implements MigrationInterface {
  name = 'AddDraftMetricsToDailyRegionalDispatchReport1789140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_regional_dispatch_report"
        ADD COLUMN IF NOT EXISTS "draftWeightKg" double precision NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "draftVolumeCbm" double precision NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "draftOrderCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "onhandOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "draftOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "daily_regional_dispatch_report"
        DROP COLUMN IF EXISTS "draftOrderCount",
        DROP COLUMN IF EXISTS "draftVolumeCbm",
        DROP COLUMN IF EXISTS "draftWeightKg",
        DROP COLUMN IF EXISTS "draftOrderCodes",
        DROP COLUMN IF EXISTS "onhandOrderCodes";
    `);
  }
}
