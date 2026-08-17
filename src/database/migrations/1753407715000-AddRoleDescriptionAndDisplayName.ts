import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleDescriptionAndDisplayName1753407715000
  implements MigrationInterface
{
  name = 'AddRoleDescriptionAndDisplayName1753407715000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role" ADD COLUMN IF NOT EXISTS "displayName" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "role" ADD COLUMN IF NOT EXISTS "description" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "role" DROP COLUMN IF EXISTS "description"`);
    await queryRunner.query(`ALTER TABLE "role" DROP COLUMN IF EXISTS "displayName"`);
  }
}
