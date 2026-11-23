import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusBucketsToWarehouseHubOrderSummary1789170000000 implements MigrationInterface {
  name = 'AddStatusBucketsToWarehouseHubOrderSummary1789170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "warehouse_hub_order_summary"
        ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'ALL';
    `);
    await queryRunner.query(`
      ALTER TABLE "warehouse_hub_order_summary"
        DROP CONSTRAINT IF EXISTS "UQ_warehouse_hub_order_summary_hubId";
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouse_hub_order_summary_hubId_status"
      ON "warehouse_hub_order_summary" ("hubId", "status");
      CREATE INDEX IF NOT EXISTS "IDX_warehouse_hub_order_summary_status"
      ON "warehouse_hub_order_summary" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_warehouse_hub_order_summary_hubId_status";',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_warehouse_hub_order_summary_status";',
    );
    await queryRunner.query(`
      ALTER TABLE "warehouse_hub_order_summary"
        DROP COLUMN IF EXISTS "status";
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_warehouse_hub_order_summary_hubId"
      ON "warehouse_hub_order_summary" ("hubId");
    `);
  }
}
