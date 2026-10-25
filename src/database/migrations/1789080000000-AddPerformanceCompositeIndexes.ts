import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceCompositeIndexes1789080000000 implements MigrationInterface {
  name = 'AddPerformanceCompositeIndexes1789080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Order Inventory Transaction composite indexes
    // Accelerates hubStockSql, hubDispatchedSql, and getInTransitQuantity subqueries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oit_order_hub_active"
      ON "order_inventory_transaction" ("orderId", "hubId")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oit_tripCode_type_active"
      ON "order_inventory_transaction" ("tripCode", "type")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oit_hub_type_created_active"
      ON "order_inventory_transaction" ("hubId", "type", "createdAt" DESC)
      WHERE "deletedAt" IS NULL
    `);

    // 2. Trip Stop composite indexes
    // Accelerates pendingInboundSql, getInboundTrips base CTE, and status filtering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_stop_hub_status_active"
      ON "trip_stop" ("hubId", "status")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_stop_trip_status_active"
      ON "trip_stop" ("tripCode", "status")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_stop_hub_stopType_active"
      ON "trip_stop" ("hubId", "stopType", "status")
      WHERE "deletedAt" IS NULL
    `);

    // 3. Trip allocation & filtering composite indexes
    // Accelerates getBatchPendingOutboundAllocations and draft trips grouping in getOutboundTrips
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_origin_status_type_active"
      ON "trip" ("originHubId", "status", "type")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_order_origin_status"
      ON "trip" ("orderId", "originHubId", "status")
      WHERE "deletedAt" IS NULL
    `);

    // 4. Order Hub & Status composite indexes
    // Accelerates hub-scoped order filtering and warehouse orders lookup
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_currentHub_status_active"
      ON "order" ("currentHubId", "status")
      WHERE "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_origin_status_active"
      ON "order" ("originHubId", "status")
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_origin_status_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_currentHub_status_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_order_origin_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_origin_status_type_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_stop_hub_stopType_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_stop_trip_status_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_stop_hub_status_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_oit_hub_type_created_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_oit_tripCode_type_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_oit_order_hub_active"`);
  }
}
