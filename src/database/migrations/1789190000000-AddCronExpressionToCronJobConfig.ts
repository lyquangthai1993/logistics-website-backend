import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCronExpressionToCronJobConfig1789190000000 implements MigrationInterface {
  name = 'AddCronExpressionToCronJobConfig1789190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cron_job_config"
        ADD COLUMN IF NOT EXISTS "cronExpression" character varying(120) NOT NULL DEFAULT '0 0 * * *';
    `);
    await queryRunner.query(`
      UPDATE "cron_job_config"
      SET "cronExpression" = CASE "jobKey"
        WHEN 'DAILY_HUB_OPERATIONAL_REPORT' THEN '5 18 * * *'
        WHEN 'PENDING_DRAFT_TRIPS_CUTOFF_REMINDER' THEN '30 17 * * *'
        WHEN 'STALE_WAREHOUSE_INVENTORY_AUDIT' THEN '0 8 * * *'
        WHEN 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT' THEN '0 6 * * *'
        WHEN 'WAREHOUSE_HUB_ORDER_TOTALS' THEN '*/5 * * * *'
        ELSE "cronExpression"
      END;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "cron_job_config"
        DROP COLUMN IF EXISTS "cronExpression";
    `);
  }
}
