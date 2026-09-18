import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOrderCodeUniqueAndAddInventoryFields1788960000000
  implements MigrationInterface
{
  name = 'DropOrderCodeUniqueAndAddInventoryFields1788960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop unique constraint and unique index on order.orderCode
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "UQ_order_orderCode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_orderCode_unique"`,
    );

    // Ensure standard non-unique index on orderCode exists for fast lookups
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_orderCode" ON "order" ("orderCode")`,
    );

    // 2. Add partial inventory tracking columns
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "inboundQuantity" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "outboundQuantity" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "remainingQuantity" integer NOT NULL DEFAULT 0`,
    );

    // 3. Backfill initial inventory quantities from existing totalQuantity
    await queryRunner.query(`
      UPDATE "order"
      SET
        "inboundQuantity" = COALESCE("totalQuantity", 1),
        "remainingQuantity" = CASE
          WHEN "status" IN ('COMPLETED_INBOUND', 'DELIVERED', 'COMPLETED_OUTBOUND') THEN 0
          ELSE COALESCE("totalQuantity", 1)
        END,
        "outboundQuantity" = CASE
          WHEN "status" IN ('COMPLETED_INBOUND', 'DELIVERED', 'COMPLETED_OUTBOUND') THEN COALESCE("totalQuantity", 1)
          ELSE 0
        END
      WHERE "inboundQuantity" = 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "remainingQuantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "outboundQuantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "inboundQuantity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "UQ_order_orderCode" UNIQUE ("orderCode")`,
    );
  }
}
