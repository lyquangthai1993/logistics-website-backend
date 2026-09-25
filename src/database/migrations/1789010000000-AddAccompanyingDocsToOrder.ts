import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccompanyingDocsToOrder1789010000000 implements MigrationInterface {
  name = 'AddAccompanyingDocsToOrder1789010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "accompanyingDocs" character varying(255) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "accompanyingDocs"`,
    );
  }
}
