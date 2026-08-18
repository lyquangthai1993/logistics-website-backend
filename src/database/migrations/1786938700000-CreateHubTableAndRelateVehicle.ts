import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHubTableAndRelateVehicle1786938700000
  implements MigrationInterface
{
  name = 'CreateHubTableAndRelateVehicle1786938700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create hub table
    await queryRunner.query(`
      CREATE TABLE "hub" (
        "id"           SERIAL PRIMARY KEY,
        "code"         character varying NOT NULL,
        "name"         character varying NOT NULL,
        "city"         character varying NOT NULL,
        "address"      character varying,
        "contactPhone" character varying,
        "managerName"  character varying,
        "isActive"     boolean NOT NULL DEFAULT true,
        "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"    TIMESTAMP,
        CONSTRAINT "UQ_hub_code" UNIQUE ("code")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_hub_code" ON "hub" ("code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_hub_isActive" ON "hub" ("isActive")`,
    );

    // 2. Add hubId column and foreign key to vehicle table
    await queryRunner.query(`
      ALTER TABLE "vehicle"
        ADD COLUMN IF NOT EXISTS "hubId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "vehicle"
        ADD CONSTRAINT "FK_vehicle_hub"
        FOREIGN KEY ("hubId")
        REFERENCES "hub"("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_vehicle_hubId" ON "vehicle" ("hubId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vehicle" DROP CONSTRAINT IF EXISTS "FK_vehicle_hub"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_vehicle_hubId"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vehicle"
        DROP COLUMN IF EXISTS "hubId"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hub_isActive"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hub_code"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "hub"`);
  }
}
