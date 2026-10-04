import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789030000000: Add originHubId, destinationHubId, and type to trip table.
 *
 * Additive-only migration:
 *  - Adds originHubId (integer nullable, FK to hub.id ON DELETE SET NULL)
 *  - Adds destinationHubId (integer nullable, FK to hub.id ON DELETE SET NULL)
 *  - Adds type (character varying(20) nullable default 'INBOUND')
 *  - Backfills existing trips from linked orders and notes
 */
export class AddHubAndTypeToTrip1789030000000 implements MigrationInterface {
  name = 'AddHubAndTypeToTrip1789030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add columns to trip
    await queryRunner.query(
      `ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "originHubId" integer NULL,
        ADD COLUMN IF NOT EXISTS "destinationHubId" integer NULL,
        ADD COLUMN IF NOT EXISTS "type" character varying(20) NOT NULL DEFAULT 'INBOUND'`,
    );

    // 2. Add foreign keys
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_trip_originHub') THEN
          ALTER TABLE "trip" ADD CONSTRAINT "FK_trip_originHub"
            FOREIGN KEY ("originHubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_trip_destinationHub') THEN
          ALTER TABLE "trip" ADD CONSTRAINT "FK_trip_destinationHub"
            FOREIGN KEY ("destinationHubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    // 3. Add indexes
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_originHubId" ON "trip" ("originHubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_destinationHubId" ON "trip" ("destinationHubId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_type" ON "trip" ("type")`,
    );

    // 4. Backfill originHubId and destinationHubId from linked order
    await queryRunner.query(`
      UPDATE "trip" t
      SET
        "originHubId" = COALESCE(t."originHubId", o."originHubId"),
        "destinationHubId" = COALESCE(t."destinationHubId", o."destinationHubId")
      FROM "order" o
      WHERE t."orderId" = o."id" AND (t."originHubId" IS NULL OR t."destinationHubId" IS NULL)
    `);

    // 5. Backfill trip type based on notes
    await queryRunner.query(`
      UPDATE "trip"
      SET "type" = 'TRANSFER'
      WHERE "notes" ILIKE '%LUÂN CHUYỂN%' OR "notes" ILIKE '%TRANSFER%'
    `);
    await queryRunner.query(`
      UPDATE "trip"
      SET "type" = 'OUTBOUND'
      WHERE ("notes" ILIKE '%XUẤT KHO%' OR "notes" ILIKE '%GIAO KHÁCH%')
        AND "notes" NOT ILIKE '%LUÂN CHUYỂN%'
    `);
    await queryRunner.query(`
      UPDATE "trip"
      SET "type" = 'INBOUND'
      WHERE "notes" ILIKE '%NHẬP KHO%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP CONSTRAINT IF EXISTS "FK_trip_destinationHub",
        DROP CONSTRAINT IF EXISTS "FK_trip_originHub",
        DROP COLUMN IF EXISTS "type",
        DROP COLUMN IF EXISTS "destinationHubId",
        DROP COLUMN IF EXISTS "originHubId"
    `);
  }
}
