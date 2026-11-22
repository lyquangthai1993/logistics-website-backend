import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWarehouseHubOrderSummaryTable1789160000000 implements MigrationInterface {
  name = 'CreateWarehouseHubOrderSummaryTable1789160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "warehouse_hub_order_summary" (
        "id" SERIAL NOT NULL,
        "hubId" integer NOT NULL,
        "totalQuantity" integer NOT NULL DEFAULT 0,
        "totalWeightKg" double precision NOT NULL DEFAULT 0,
        "totalVolumeCbm" double precision NOT NULL DEFAULT 0,
        "orderCount" integer NOT NULL DEFAULT 0,
        "triggeredBy" character varying(30) NOT NULL DEFAULT 'CRON',
        "calculatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_warehouse_hub_order_summary_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_warehouse_hub_order_summary_hubId" UNIQUE ("hubId"),
        CONSTRAINT "FK_warehouse_hub_order_summary_hub" FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_warehouse_hub_order_summary_hubId"
      ON "warehouse_hub_order_summary" ("hubId");
      CREATE INDEX IF NOT EXISTS "IDX_warehouse_hub_order_summary_calculatedAt"
      ON "warehouse_hub_order_summary" ("calculatedAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "warehouse_hub_order_summary";',
    );
  }
}
