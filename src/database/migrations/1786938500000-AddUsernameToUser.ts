import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsernameToUser1786938500000 implements MigrationInterface {
  name = 'AddUsernameToUser1786938500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" character varying`,
    );
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_user_username'
        ) THEN
          ALTER TABLE "user" ADD CONSTRAINT "UQ_user_username" UNIQUE ("username");
        END IF;
      END $$;`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_username" ON "user" ("username")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_username"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "UQ_user_username"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "username"`,
    );
  }
}
