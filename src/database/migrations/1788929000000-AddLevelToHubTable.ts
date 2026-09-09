import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLevelToHubTable1788929000000 implements MigrationInterface {
  name = 'AddLevelToHubTable1788929000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hub"
        ADD COLUMN IF NOT EXISTS "level" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_hub_level" ON "hub" ("level")`,
    );

    // Update level to 2 for all existing Xe Bo hubs
    await queryRunner.query(`
      UPDATE "hub"
      SET "level" = 2
      WHERE "code" LIKE 'HUB-BO-%' OR "name" LIKE 'Xe bo%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hub_level"`);
    await queryRunner.query(`
      ALTER TABLE "hub"
        DROP COLUMN IF EXISTS "level"
    `);
  }
}
