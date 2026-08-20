import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHubIdToUser1786938800000 implements MigrationInterface {
  name = 'AddHubIdToUser1786938800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add nullable hubId column to user table
    await queryRunner.query(
      `ALTER TABLE "user" ADD "hubId" integer NULL`,
    );

    // Add foreign key referencing hub table
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_user_hub" FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "FK_user_hub"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "hubId"`,
    );
  }
}
