import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderActivityLogTable1789070000000 implements MigrationInterface {
  name = 'CreateOrderActivityLogTable1789070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_activity_log" (
        "id" SERIAL NOT NULL,
        "orderId" integer,
        "orderCode" character varying(100) NOT NULL,
        "action" character varying(50) NOT NULL,
        "actorUserId" integer NOT NULL,
        "actorEmail" character varying(255),
        "actorRole" character varying(100),
        "hubId" integer NOT NULL,
        "hubName" character varying(255),
        "tripCode" character varying(100),
        "oldValues" jsonb,
        "newValues" jsonb,
        "quantity" integer,
        "reason" text,
        "bearerToken" text,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_activity_log_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_activity_log_orderId" ON "order_activity_log" ("orderId");
      CREATE INDEX IF NOT EXISTS "IDX_order_activity_log_orderCode" ON "order_activity_log" ("orderCode");
      CREATE INDEX IF NOT EXISTS "IDX_order_activity_log_action" ON "order_activity_log" ("action");
      CREATE INDEX IF NOT EXISTS "IDX_order_activity_log_tripCode" ON "order_activity_log" ("tripCode");
      CREATE INDEX IF NOT EXISTS "IDX_order_activity_log_createdAt" ON "order_activity_log" ("createdAt" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_activity_log";`);
  }
}
