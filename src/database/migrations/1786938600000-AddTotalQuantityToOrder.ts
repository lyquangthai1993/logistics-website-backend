import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTotalQuantityToOrder1786938600000 implements MigrationInterface {
  name = 'AddTotalQuantityToOrder1786938600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "totalQuantity" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "totalQuantity"`,
    );
  }
}
