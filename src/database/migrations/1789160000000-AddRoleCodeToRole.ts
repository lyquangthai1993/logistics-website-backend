import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleCodeToRole1789160000000 implements MigrationInterface {
  name = 'AddRoleCodeToRole1789160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role" ADD COLUMN "role_code" character varying(50)`,
    );
    await queryRunner.query(`
      UPDATE "role"
      SET "role_code" = CASE "id"
        WHEN 1 THEN 'SUPER_ADMIN'
        WHEN 2 THEN 'DISPATCHER'
        WHEN 3 THEN 'FLEET_MANAGER'
        WHEN 4 THEN 'WAREHOUSE_MANAGER'
        WHEN 5 THEN 'REPORT_VIEWER'
        ELSE NULLIF(
          TRIM(BOTH '_' FROM UPPER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '_', 'g'))),
          ''
        )
      END
      WHERE "role_code" IS NULL;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "role" WHERE "role_code" IS NULL) THEN
          RAISE EXCEPTION 'Cannot assign role_code to every role; review blank role names';
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "role" ALTER COLUMN "role_code" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "role" ADD CONSTRAINT "UQ_role_role_code" UNIQUE ("role_code")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "role" DROP CONSTRAINT "UQ_role_role_code"`,
    );
    await queryRunner.query(`ALTER TABLE "role" DROP COLUMN "role_code"`);
  }
}
