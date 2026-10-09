import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeUserUniqueIndexesPartial1789050000000
  implements MigrationInterface
{
  name = 'MakeUserUniqueIndexesPartial1789050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop existing global unique constraints if they exist
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_e12875dfb3b1d92d7d7c5377e22"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_user_username"`,
    );

    // 2. Drop any legacy non-partial index on username if created by @Index
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_username"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_email"`);

    // 3. Create partial unique indexes that only apply to active (non-soft-deleted) accounts
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_email_active" ON "user" ("email") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_username_active" ON "user" ("username") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop partial unique indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_email_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_username_active"`);

    // 2. Restore global unique constraints
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email")`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "UQ_user_username" UNIQUE ("username")`,
    );
  }
}
