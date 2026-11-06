import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeXeBoHubLevel1789110000000 implements MigrationInterface {
  name = 'NormalizeXeBoHubLevel1789110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "hub"
      SET "level" = 2
      WHERE "level" = 1
        AND (
          "code" ILIKE 'XB-%'
          OR "code" ILIKE 'HUB-BO-%'
          OR "name" ILIKE '%xe bo%'
        )
    `);
  }

  public async down(): Promise<void> {
    // Non-destructive data normalization for satellite Xe Bo hubs.
  }
}
