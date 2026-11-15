import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProvinceReferenceTable1789140000000 implements MigrationInterface {
  name = 'CreateProvinceReferenceTable1789140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "province_reference" (
        "id" SERIAL NOT NULL,
        "name" character varying(120) NOT NULL,
        "normalizedName" character varying(120) NOT NULL,
        "region" character varying(20) NOT NULL,
        "aliases" text[] NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_province_reference_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_province_reference_name" UNIQUE ("name"),
        CONSTRAINT "UQ_province_reference_normalized_name" UNIQUE ("normalizedName")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_province_reference_region" ON "province_reference" ("region")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "province_reference"');
  }
}
