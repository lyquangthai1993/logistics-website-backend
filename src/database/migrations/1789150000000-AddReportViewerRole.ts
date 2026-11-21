import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReportViewerRole1789150000000 implements MigrationInterface {
  name = 'AddReportViewerRole1789150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "role"
          WHERE "id" = 5 AND "name" NOT IN ('Report Viewer', 'REPORT_VIEWER')
        ) THEN
          RAISE EXCEPTION 'Role ID 5 is already assigned to a different role';
        END IF;

        INSERT INTO "role" ("id", "name", "displayName", "description")
        VALUES (
          5,
          'Report Viewer',
          U&'Ch\\1ec9 xem b\\00e1o c\\00e1o',
          'Read-only access to operational reports and trip details.'
        )
        ON CONFLICT ("id") DO UPDATE SET
          "name" = EXCLUDED."name",
          "displayName" = EXCLUDED."displayName",
          "description" = EXCLUDED."description";
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM "user" WHERE "roleId" = 5) THEN
          RAISE EXCEPTION 'Cannot remove REPORT_VIEWER while users are assigned to it';
        END IF;

        DELETE FROM "role" WHERE "id" = 5 AND "name" = 'Report Viewer';
      END $$;
    `);
  }
}
