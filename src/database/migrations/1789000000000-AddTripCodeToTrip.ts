import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTripCodeToTrip1789000000000 implements MigrationInterface {
  name = 'AddTripCodeToTrip1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" ADD COLUMN IF NOT EXISTS "tripCode" character varying NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trip_tripCode" ON "trip" ("tripCode")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trip_tripCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trip" DROP COLUMN IF EXISTS "tripCode"`,
    );
  }
}
