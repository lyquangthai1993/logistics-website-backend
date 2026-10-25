import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusTabPartialIndexes1789090000000 implements MigrationInterface {
  name = 'AddStatusTabPartialIndexes1789090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Order Status Tab partial indexes (Lưu kho, Đang luân chuyển, Đã giao, Chờ xử lý)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_stored_active"
      ON "order" ("currentHubId", "id" DESC)
      WHERE "status" = 'STORED' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_transit_active"
      ON "order" ("currentHubId", "destinationHubId", "id" DESC)
      WHERE "status" = 'IN_TRANSIT' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_delivered_active"
      ON "order" ("destinationHubId", "id" DESC)
      WHERE "status" = 'DELIVERED' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_pending_active"
      ON "order" ("originHubId", "id" DESC)
      WHERE "status" = 'PENDING' AND "deletedAt" IS NULL
    `);

    // 2. Trip Status Tab partial indexes (Chờ xuất kho, Đang trung chuyển, Hoàn tất)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_pending_outbound_active"
      ON "trip" ("originHubId", "type", "id" DESC)
      WHERE "status" = 'PENDING' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_transit_active"
      ON "trip" ("destinationHubId", "type", "id" DESC)
      WHERE "status" = 'IN_TRANSIT' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_trip_completed_active"
      ON "trip" ("destinationHubId", "id" DESC)
      WHERE "status" = 'COMPLETED' AND "deletedAt" IS NULL
    `);

    // 3. Inventory Transaction Type partial indexes
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oit_inbound_active"
      ON "order_inventory_transaction" ("hubId", "orderId", "createdAt" DESC)
      WHERE "type" = 'INBOUND' AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_oit_outbound_active"
      ON "order_inventory_transaction" ("hubId", "tripCode", "createdAt" DESC)
      WHERE "type" IN ('OUTBOUND', 'TRANSFER') AND "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_oit_outbound_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_oit_inbound_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_completed_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_transit_active"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_pending_outbound_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_pending_active"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_delivered_active"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_transit_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_stored_active"`);
  }
}
