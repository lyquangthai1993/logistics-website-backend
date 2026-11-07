import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDailyHubOperationalReportTable1789120000000 implements MigrationInterface {
  name = 'CreateDailyHubOperationalReportTable1789120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_hub_operational_report" (
        "id" SERIAL NOT NULL,
        "reportDate" character varying(10) NOT NULL,
        "windowStart" TIMESTAMP NOT NULL,
        "windowEnd" TIMESTAMP NOT NULL,
        "hubId" integer NOT NULL,
        "inboundVolumeCbm" double precision NOT NULL DEFAULT 0,
        "inboundWeightKg" double precision NOT NULL DEFAULT 0,
        "inboundPackageCount" integer NOT NULL DEFAULT 0,
        "inboundTripCount" integer NOT NULL DEFAULT 0,
        "inboundOrderCount" integer NOT NULL DEFAULT 0,
        "outboundVolumeCbm" double precision NOT NULL DEFAULT 0,
        "outboundWeightKg" double precision NOT NULL DEFAULT 0,
        "outboundPackageCount" integer NOT NULL DEFAULT 0,
        "outboundTripCount" integer NOT NULL DEFAULT 0,
        "outboundOrderCount" integer NOT NULL DEFAULT 0,
        "triggeredBy" character varying(30) NOT NULL DEFAULT 'CRON',
        "calculatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_daily_hub_operational_report_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_hub_operational_report_date_hub" UNIQUE ("reportDate", "hubId"),
        CONSTRAINT "FK_daily_hub_operational_report_hub" FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_hub_op_report_reportDate" ON "daily_hub_operational_report" ("reportDate");
      CREATE INDEX IF NOT EXISTS "IDX_daily_hub_op_report_hubId" ON "daily_hub_operational_report" ("hubId");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cron_job_config" (
        "id" SERIAL NOT NULL,
        "jobKey" character varying(80) NOT NULL,
        "name" character varying(150) NOT NULL,
        "description" text,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "cronTime" character varying(5) NOT NULL DEFAULT '18:05',
        "cutoffHour" integer NOT NULL DEFAULT 18,
        "notifySuperAdmins" boolean NOT NULL DEFAULT true,
        "lastRunAt" TIMESTAMP,
        "lastRunStatus" character varying(20),
        "lastReportDate" character varying(10),
        "updatedByUserId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_cron_job_config_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_cron_job_config_jobKey" UNIQUE ("jobKey")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_config_jobKey" ON "cron_job_config" ("jobKey");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cron_job_execution_log" (
        "id" SERIAL NOT NULL,
        "jobKey" character varying(80) NOT NULL,
        "targetDate" character varying(10) NOT NULL,
        "targetEndDate" character varying(10) NOT NULL,
        "windowLabel" character varying(120) NOT NULL,
        "triggeredBy" character varying(30) NOT NULL,
        "actorUserId" integer,
        "actorEmail" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'SUCCESS',
        "processedDays" integer NOT NULL DEFAULT 1,
        "upsertedHubRows" integer NOT NULL DEFAULT 0,
        "totalInboundCbm" double precision NOT NULL DEFAULT 0,
        "totalInboundTons" double precision NOT NULL DEFAULT 0,
        "totalInboundTrips" integer NOT NULL DEFAULT 0,
        "totalOutboundCbm" double precision NOT NULL DEFAULT 0,
        "totalOutboundTons" double precision NOT NULL DEFAULT 0,
        "totalOutboundTrips" integer NOT NULL DEFAULT 0,
        "durationMs" integer NOT NULL DEFAULT 0,
        "errorMessage" text,
        "startedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_cron_job_execution_log_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_exec_log_jobKey" ON "cron_job_execution_log" ("jobKey");
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_exec_log_targetDate" ON "cron_job_execution_log" ("targetDate");
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_exec_log_status" ON "cron_job_execution_log" ("status");
      CREATE INDEX IF NOT EXISTS "IDX_cron_job_exec_log_startedAt" ON "cron_job_execution_log" ("startedAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cron_job_execution_log";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cron_job_config";`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "daily_hub_operational_report";`,
    );
  }
}
