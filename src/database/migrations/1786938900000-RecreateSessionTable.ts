import { MigrationInterface, QueryRunner } from 'typeorm';

export class RecreateSessionTable1786938900000 implements MigrationInterface {
  name = 'RecreateSessionTable1786938900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "createdAt"  TIMESTAMP         NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP         NOT NULL DEFAULT now(),
        "deletedAt"  TIMESTAMP,
        "id"         SERIAL            NOT NULL,
        "hash"       character varying NOT NULL,
        "userId"     integer,
        CONSTRAINT "PK_session_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_session_userId"
      ON "session" ("userId")
    `);

    await queryRunner.query(`
      ALTER TABLE "session"
      ADD CONSTRAINT "FK_session_user"
      FOREIGN KEY ("userId")
      REFERENCES "user"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session" DROP CONSTRAINT IF EXISTS "FK_session_user"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_session_userId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "session"`);
  }
}
