import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubFkToOrder1786939000000 implements MigrationInterface {
  name = 'AddHubFkToOrder1786939000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add originHubId FK (nullable, backward-compat — originHub VARCHAR is kept)
    await queryRunner.query(
      `ALTER TABLE "order" ADD "originHubId" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_order_originHub"
       FOREIGN KEY ("originHubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Add destinationHubId FK (nullable, backward-compat — destinationHub VARCHAR is kept)
    await queryRunner.query(
      `ALTER TABLE "order" ADD "destinationHubId" integer NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" ADD CONSTRAINT "FK_order_destinationHub"
       FOREIGN KEY ("destinationHubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "FK_order_destinationHub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "destinationHubId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "FK_order_originHub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "originHubId"`,
    );
  }
}
