import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderInventoryTransactionTable1788990000000
  implements MigrationInterface
{
  name = 'CreateOrderInventoryTransactionTable1788990000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create order_inventory_transaction table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_inventory_transaction" (
        "id" SERIAL PRIMARY KEY,
        "orderId" integer NOT NULL,
        "type" character varying(50) NOT NULL DEFAULT 'INBOUND',
        "quantity" integer NOT NULL DEFAULT 0,
        "remainingQuantity" integer NOT NULL DEFAULT 0,
        "weight" double precision NOT NULL DEFAULT 0,
        "volume" double precision NOT NULL DEFAULT 0,
        "licensePlate" character varying(100) NULL,
        "driverName" character varying(150) NULL,
        "destination" character varying(255) NULL,
        "performedByUserId" integer NULL,
        "notes" text NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP NULL,
        CONSTRAINT "FK_order_inventory_transaction_order" FOREIGN KEY ("orderId")
          REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    // 2. Indexes for fast timeline lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_orderId"
        ON "order_inventory_transaction" ("orderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_type"
        ON "order_inventory_transaction" ("type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_createdAt"
        ON "order_inventory_transaction" ("createdAt")
    `);

    // 3. Backfill initial INBOUND transaction for existing orders
    await queryRunner.query(`
      INSERT INTO "order_inventory_transaction" (
        "orderId", "type", "quantity", "remainingQuantity", "weight", "volume", "notes", "createdAt", "updatedAt"
      )
      SELECT
        o.id,
        'INBOUND',
        COALESCE(o."inboundQuantity", o."totalQuantity", 1),
        COALESCE(o."inboundQuantity", o."totalQuantity", 1),
        COALESCE(o."totalWeight", 0),
        COALESCE(o."totalVolume", 0),
        'Tiếp nhận nhập kho ban đầu',
        o."createdAt",
        o."updatedAt"
      FROM "order" o
      WHERE o."deletedAt" IS NULL
    `);

    // 4. Backfill initial OUTBOUND transaction for existing orders with outboundQuantity > 0
    await queryRunner.query(`
      INSERT INTO "order_inventory_transaction" (
        "orderId", "type", "quantity", "remainingQuantity", "weight", "volume", "notes", "createdAt", "updatedAt"
      )
      SELECT
        o.id,
        'OUTBOUND',
        o."outboundQuantity",
        o."remainingQuantity",
        COALESCE(o."totalWeight", 0),
        COALESCE(o."totalVolume", 0),
        'Đã xuất kho',
        o."updatedAt",
        o."updatedAt"
      FROM "order" o
      WHERE o."deletedAt" IS NULL AND o."outboundQuantity" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "order_inventory_transaction"`,
    );
  }
}
