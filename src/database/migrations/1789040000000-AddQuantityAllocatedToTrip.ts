import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 1789040000000: Add quantityAllocated to trip table.
 *
 * Additive-only migration (approved 05/10):
 *  - Adds quantityAllocated (integer NULL): planned package count of an order line on a trip.
 *    Used by outbound draft trips ("Chờ xử lý") which have no dispatch invoice yet.
 *  - Existing rows keep NULL (no backfill, no data change).
 */
export class AddQuantityAllocatedToTrip1789040000000
  implements MigrationInterface
{
  name = 'AddQuantityAllocatedToTrip1789040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" ADD COLUMN IF NOT EXISTS "quantityAllocated" integer NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trip" DROP COLUMN IF EXISTS "quantityAllocated"`,
    );
  }
}
