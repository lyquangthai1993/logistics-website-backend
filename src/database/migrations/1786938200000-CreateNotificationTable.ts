import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationTable1786938200000 implements MigrationInterface {
  name = 'CreateNotificationTable1786938200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id"         SERIAL PRIMARY KEY,
        "userId"     INTEGER NOT NULL,
        "title"      VARCHAR(255) NOT NULL,
        "body"       TEXT NOT NULL,
        "type"       VARCHAR(50) NOT NULL DEFAULT 'GENERIC',
        "isRead"     BOOLEAN NOT NULL DEFAULT false,
        "metadata"   JSONB,
        "createdAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt"  TIMESTAMP
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_notification_userId" ON "notification" ("userId")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_notification_userId_isRead" ON "notification" ("userId", "isRead")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_notification_userId_isRead"`);
    await queryRunner.query(`DROP INDEX "IDX_notification_userId"`);
    await queryRunner.query(`DROP TABLE "notification"`);
  }
}
