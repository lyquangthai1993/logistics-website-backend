import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderAndTripTables1786938300000 implements MigrationInterface {
  name = 'CreateOrderAndTripTables1786938300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create order table
    await queryRunner.query(`
      CREATE TABLE "order" (
        "id"                      SERIAL PRIMARY KEY,
        "orderCode"               character varying NOT NULL,
        "status"                  character varying NOT NULL DEFAULT 'DRAFT',
        "route"                   character varying,
        "originHub"               character varying,
        "destinationHub"          character varying,
        "totalWeight"             double precision NOT NULL DEFAULT '0',
        "totalVolume"             double precision NOT NULL DEFAULT '0',
        "goodsDescription"        text,
        "isExternalVehicleNeeded" boolean NOT NULL DEFAULT false,
        "createdByUserId"         integer,
        "notes"                   text,
        "createdAt"               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"               TIMESTAMP,
        CONSTRAINT "UQ_order_orderCode" UNIQUE ("orderCode")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_order_orderCode" ON "order" ("orderCode")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_status" ON "order" ("status")`,
    );

    // 2. Create trip table
    await queryRunner.query(`
      CREATE TABLE "trip" (
        "id"                    SERIAL PRIMARY KEY,
        "orderId"               integer NOT NULL,
        "vehicleId"             integer,
        "driverId"              integer,
        "status"                character varying NOT NULL DEFAULT 'PENDING',
        "pickupDate"            character varying,
        "pickupTime"            character varying,
        "estimatedDeliveryDate" character varying,
        "weightAllocated"       double precision NOT NULL DEFAULT '0',
        "volumeAllocated"       double precision NOT NULL DEFAULT '0',
        "sequenceNumber"        integer NOT NULL DEFAULT 1,
        "assignedByUserId"      integer,
        "notes"                 text,
        "createdAt"             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"             TIMESTAMP,
        CONSTRAINT "FK_trip_order" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_trip_vehicle" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_trip_driver" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_trip_orderId" ON "trip" ("orderId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_trip_status" ON "trip" ("status")`,
    );

    // 3. Add columns to vehicle table
    await queryRunner.query(`
      ALTER TABLE "vehicle"
        ADD COLUMN IF NOT EXISTS "isExternal" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "externalProvider" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vehicle"
        DROP COLUMN IF EXISTS "externalProvider",
        DROP COLUMN IF EXISTS "isExternal"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_trip_orderId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trip"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_orderCode"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order"`);
  }
}
