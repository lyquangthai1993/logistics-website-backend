import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarehousePerformanceIndexes1788970000000
  implements MigrationInterface
{
  name = 'AddWarehousePerformanceIndexes1788970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Core Timeline & Sorting Indexes (Eliminates full table sorts on createdAt DESC)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_createdAt" ON "order" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_updatedAt" ON "order" ("updatedAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_createdAt" ON "trip" ("createdAt" DESC)`,
    );

    // 2. Hub Scoping Indexes (Accelerates warehouse manager multi-hub filters)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_originHubId" ON "order" ("originHubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_destinationHubId" ON "order" ("destinationHubId")`,
    );

    // 3. Vehicle Trip Indexes (Accelerates outbound grouping by vehicle license plate)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_licensePlate" ON "trip" ("licensePlate")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_order_deleted" ON "trip" ("orderId", "deletedAt")`,
    );

    // 4. Composite Filter Index (Accelerates status tab counts with soft delete)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_status_created" ON "order" ("status", "createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );

    // 5. Trigram extension and GIN indexes for super-fast ILIKE '%search%' queries
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_search_trgm" ON "order" USING gin ("orderCode" gin_trgm_ops, "goodsDescription" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_plate_trgm" ON "trip" USING gin ("licensePlate" gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_plate_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_search_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_order_deleted"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_licensePlate"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_destinationHubId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_originHubId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_updatedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_createdAt"`);
  }
}
