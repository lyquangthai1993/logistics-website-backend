import { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanTripColumnsOnlyPlateAndDriverName1788950000000
  implements MigrationInterface
{
  name = 'CleanTripColumnsOnlyPlateAndDriverName1788950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip"
        DROP COLUMN IF EXISTS "vehicleType",
        DROP COLUMN IF EXISTS "driverPhone",
        DROP COLUMN IF EXISTS "isExternalVehicle",
        DROP COLUMN IF EXISTS "externalProvider"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trip"
        ADD COLUMN IF NOT EXISTS "vehicleType" character varying,
        ADD COLUMN IF NOT EXISTS "driverPhone" character varying,
        ADD COLUMN IF NOT EXISTS "isExternalVehicle" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "externalProvider" character varying
    `);
  }
}
