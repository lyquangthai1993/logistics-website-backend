import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveVehicleRelationFromTrip1788930000000
  implements MigrationInterface
{
  name = 'RemoveVehicleRelationFromTrip1788930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add direct vehicle and driver columns to trip table
    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "licensePlate" character varying,
        ADD COLUMN IF NOT EXISTS "driverName" character varying,
        ADD COLUMN IF NOT EXISTS "driverPhone" character varying,
        ADD COLUMN IF NOT EXISTS "vehicleType" character varying,
        ADD COLUMN IF NOT EXISTS "isExternalVehicle" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "externalProvider" character varying
    `);

    // 2. Safely backfill existing vehicle and driver data into new trip columns
    await queryRunner.query(`
      UPDATE "trip" t
      SET
        "licensePlate" = v."licensePlate",
        "vehicleType" = v."type",
        "isExternalVehicle" = COALESCE(v."isExternal", false),
        "externalProvider" = v."externalProvider"
      FROM "vehicle" v
      WHERE t."vehicleId" = v."id" AND t."licensePlate" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "trip" t
      SET
        "driverName" = d."fullName",
        "driverPhone" = d."phone"
      FROM "driver" d
      WHERE t."driverId" = d."id" AND t."driverName" IS NULL
    `);

    // 3. Drop foreign key constraint and vehicleId column from trip
    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP CONSTRAINT IF EXISTS "FK_trip_vehicle"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP COLUMN IF EXISTS "vehicleId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "vehicleId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD CONSTRAINT "FK_trip_vehicle" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP COLUMN IF EXISTS "externalProvider",
        DROP COLUMN IF EXISTS "isExternalVehicle",
        DROP COLUMN IF EXISTS "vehicleType",
        DROP COLUMN IF EXISTS "driverPhone",
        DROP COLUMN IF EXISTS "driverName",
        DROP COLUMN IF EXISTS "licensePlate"
    `);
  }
}
