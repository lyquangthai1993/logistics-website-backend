import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProvinceToOrder1788980000000 implements MigrationInterface {
  name = 'AddProvinceToOrder1788980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "province" character varying(150) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "province"`,
    );
  }
}
