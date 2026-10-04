import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Master Contract & Operational Invoices (IMPLEMENT_STATUS_TRIP_AND_ORDER.md v2.1.0)
 *
 * Additive-only migration (no column rename / drop on existing data):
 *  1. Sequence `trip_code_sd_seq` for short global trip codes SD1, SD2, ...
 *  2. Table `trip_stop` — per-hub processing status of a logical trip (grouped by tripCode).
 *  3. `order.currentHubId`, `order.currentTripCode` — live location of goods
 *     (contract columns totalQuantity / totalWeight / totalVolume stay untouched).
 *  4. `order_inventory_transaction` invoice columns: invoiceCode, hubId, tripId, tripCode,
 *     expectedQuantity, discrepancyQuantity, discrepancyReason.
 *  5. Backfill (new columns only): currentHubId, transaction hubId, trip stops for legacy trip codes.
 */
export class OrderMasterContractAndTripStops1789020000000
  implements MigrationInterface
{
  name = 'OrderMasterContractAndTripStops1789020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Global SD trip code sequence
    await queryRunner.query(
      `CREATE SEQUENCE IF NOT EXISTS "trip_code_sd_seq" START WITH 1 INCREMENT BY 1 MINVALUE 1`,
    );
    // Align sequence if SD codes already exist (defensive, idempotent)
    await queryRunner.query(`
      DO $$
      DECLARE max_sd integer;
      BEGIN
        SELECT MAX(CAST(SUBSTRING("tripCode" FROM 3) AS integer)) INTO max_sd
          FROM "trip" WHERE "tripCode" ~ '^SD[0-9]+$';
        IF max_sd IS NOT NULL THEN
          PERFORM setval('trip_code_sd_seq', max_sd, true);
        END IF;
      END $$;
    `);

    // 2. trip_stop table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trip_stop" (
        "id" SERIAL PRIMARY KEY,
        "tripCode" character varying(50) NOT NULL,
        "hubId" integer NOT NULL,
        "stopSequence" integer NOT NULL DEFAULT 1,
        "stopType" character varying(20) NOT NULL DEFAULT 'TRANSIT',
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "processedAt" TIMESTAMP NULL,
        "processedByUserId" integer NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP NULL,
        CONSTRAINT "UQ_trip_stop_tripCode_hubId" UNIQUE ("tripCode", "hubId"),
        CONSTRAINT "FK_trip_stop_hub" FOREIGN KEY ("hubId")
          REFERENCES "hub"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_stop_tripCode" ON "trip_stop" ("tripCode")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_stop_hubId" ON "trip_stop" ("hubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_stop_status" ON "trip_stop" ("status")`,
    );

    // 3. order live-location columns
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "currentHubId" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "currentTripCode" character varying(50) NULL`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_order_currentHub') THEN
          ALTER TABLE "order" ADD CONSTRAINT "FK_order_currentHub" FOREIGN KEY ("currentHubId")
            REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_currentHubId" ON "order" ("currentHubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_currentTripCode" ON "order" ("currentTripCode")`,
    );

    // 4. Operational invoice columns on the ledger
    await queryRunner.query(`
      ALTER TABLE "order_inventory_transaction"
        ADD COLUMN IF NOT EXISTS "invoiceCode" character varying(50) NULL,
        ADD COLUMN IF NOT EXISTS "hubId" integer NULL,
        ADD COLUMN IF NOT EXISTS "tripId" integer NULL,
        ADD COLUMN IF NOT EXISTS "tripCode" character varying(50) NULL,
        ADD COLUMN IF NOT EXISTS "expectedQuantity" integer NULL,
        ADD COLUMN IF NOT EXISTS "discrepancyQuantity" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "discrepancyReason" text NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_order_inventory_transaction_hub') THEN
          ALTER TABLE "order_inventory_transaction" ADD CONSTRAINT "FK_order_inventory_transaction_hub"
            FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_hubId" ON "order_inventory_transaction" ("hubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_tripCode" ON "order_inventory_transaction" ("tripCode")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_inventory_transaction_invoiceCode" ON "order_inventory_transaction" ("invoiceCode")`,
    );

    // 5. Backfill — only the newly added columns are written.
    // 5a. Goods still in stock are located at the hub that last received them
    //     (legacy confirmInbound moved originHubId to the receiving hub).
    await queryRunner.query(`
      UPDATE "order" SET "currentHubId" = "originHubId"
      WHERE "currentHubId" IS NULL AND "originHubId" IS NOT NULL AND "remainingQuantity" > 0
    `);
    // 5b. Legacy ledger rows were all performed at the order's (last) hub.
    await queryRunner.query(`
      UPDATE "order_inventory_transaction" tx SET "hubId" = o."originHubId"
      FROM "order" o
      WHERE tx."orderId" = o.id AND tx."hubId" IS NULL AND o."originHubId" IS NOT NULL
    `);
    // 5c. Legacy intake trips with a code: one stop at the receiving hub.
    await queryRunner.query(`
      INSERT INTO "trip_stop" ("tripCode", "hubId", "stopSequence", "stopType", "status", "processedAt", "createdAt", "updatedAt")
      SELECT t."tripCode", o."originHubId", 1, 'DESTINATION',
             CASE WHEN bool_and(t.status = 'COMPLETED') THEN 'COMPLETED' ELSE 'PENDING' END,
             CASE WHEN bool_and(t.status = 'COMPLETED') THEN MAX(t."updatedAt") ELSE NULL END,
             MIN(t."createdAt"), MAX(t."updatedAt")
      FROM "trip" t
      JOIN "order" o ON o.id = t."orderId"
      WHERE t."tripCode" IS NOT NULL AND t."deletedAt" IS NULL AND o."originHubId" IS NOT NULL
      GROUP BY t."tripCode", o."originHubId"
      ON CONFLICT ("tripCode", "hubId") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_inventory_transaction_invoiceCode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_inventory_transaction_tripCode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_inventory_transaction_hubId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_inventory_transaction" DROP CONSTRAINT IF EXISTS "FK_order_inventory_transaction_hub"`,
    );
    await queryRunner.query(`
      ALTER TABLE "order_inventory_transaction"
        DROP COLUMN IF EXISTS "discrepancyReason",
        DROP COLUMN IF EXISTS "discrepancyQuantity",
        DROP COLUMN IF EXISTS "expectedQuantity",
        DROP COLUMN IF EXISTS "tripCode",
        DROP COLUMN IF EXISTS "tripId",
        DROP COLUMN IF EXISTS "hubId",
        DROP COLUMN IF EXISTS "invoiceCode"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_currentTripCode"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_currentHubId"`);
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "FK_order_currentHub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "currentTripCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "currentHubId"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "trip_stop"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "trip_code_sd_seq"`);
  }
}
