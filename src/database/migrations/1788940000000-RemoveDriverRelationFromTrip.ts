import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDriverRelationFromTrip1788940000000
  implements MigrationInterface
{
  name = 'RemoveDriverRelationFromTrip1788940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure driverName and driverPhone columns exist
    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "driverName" character varying,
        ADD COLUMN IF NOT EXISTS "driverPhone" character varying
    `);

    // 2. Safely backfill any existing driver data into trip columns if not already filled
    await queryRunner.query(`
      UPDATE "trip" t
      SET
        "driverName" = COALESCE(t."driverName", d."fullName"),
        "driverPhone" = COALESCE(t."driverPhone", d."phone")
      FROM "driver" d
      WHERE t."driverId" = d."id" AND (t."driverName" IS NULL OR t."driverPhone" IS NULL)
    `);

    // 3. Drop foreign key constraints linking trip to driver
    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP CONSTRAINT IF EXISTS "FK_trip_driver"
    `);

    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP CONSTRAINT IF EXISTS "FK_2034f2f2e58179b42c4866f6f13"
    `);

    // 4. Drop driverId column from trip table
    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP COLUMN IF EXISTS "driverId"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "driverId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD CONSTRAINT "FK_trip_driver" FOREIGN KEY ("driverId") REFERENCES "driver"("id") ON DELETE SET NULL
    `);
  }
}
