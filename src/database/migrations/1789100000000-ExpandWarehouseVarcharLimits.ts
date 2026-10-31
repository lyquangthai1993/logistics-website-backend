import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandWarehouseVarcharLimits1789100000000 implements MigrationInterface {
  name = 'ExpandWarehouseVarcharLimits1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_inventory_transaction"
        ALTER COLUMN "destination" TYPE text,
        ALTER COLUMN "driverName" TYPE character varying(255),
        ALTER COLUMN "licensePlate" TYPE character varying(255)
    `);

    await queryRunner.query(`
      ALTER TABLE "order"
        ALTER COLUMN "accompanyingDocs" TYPE text,
        ALTER COLUMN "province" TYPE character varying(500)
    `);

    await queryRunner.query(`
      ALTER TABLE "order_activity_log"
        ALTER COLUMN "hubName" TYPE text,
        ALTER COLUMN "actorEmail" TYPE character varying(500),
        ALTER COLUMN "orderCode" TYPE character varying(255),
        ALTER COLUMN "tripCode" TYPE character varying(255),
        ALTER COLUMN "actorRole" TYPE character varying(255)
    `);
  }

  public async down(): Promise<void> {
    // Non-destructive column type expansion to text; no down truncation to prevent data loss.
  }
}
