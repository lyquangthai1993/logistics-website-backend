import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalNoteToOrder1786938400000 implements MigrationInterface {
  name = 'AddExternalNoteToOrder1786938400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "externalNote" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "externalNote"`,
    );
  }
}
