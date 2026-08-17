import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditColumnsToFile1753410000000 implements MigrationInterface {
  name = 'AddAuditColumnsToFile1753410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add createdAt with default now() so existing rows get a value
    await queryRunner.query(
      `ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    // Add updatedAt with default now()
    await queryRunner.query(
      `ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()`,
    );
    // Add deletedAt nullable (soft-delete)
    await queryRunner.query(
      `ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP`,
    );
    // Add createdBy as nullable FK to user
    await queryRunner.query(
      `ALTER TABLE "file" ADD COLUMN IF NOT EXISTS "createdBy" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" ADD CONSTRAINT "FK_file_createdBy_user" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file" DROP CONSTRAINT IF EXISTS "FK_file_createdBy_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" DROP COLUMN IF EXISTS "createdBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" DROP COLUMN IF EXISTS "deletedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" DROP COLUMN IF EXISTS "updatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file" DROP COLUMN IF EXISTS "createdAt"`,
    );
  }
}
