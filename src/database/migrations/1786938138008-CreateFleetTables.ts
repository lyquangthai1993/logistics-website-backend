import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFleetTables1786938138008 implements MigrationInterface {
  name = 'CreateFleetTables1786938138008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vehicle" ("id" SERIAL NOT NULL, "licensePlate" character varying NOT NULL, "model" character varying, "type" character varying NOT NULL DEFAULT 'CONTAINER_40FT', "maxWeight" double precision NOT NULL DEFAULT '25000', "maxVolume" double precision NOT NULL DEFAULT '65', "currentHub" character varying, "status" character varying NOT NULL DEFAULT 'AVAILABLE', "assignedDriverId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "UQ_a654a0355ae4c5ba31c5f6c8925" UNIQUE ("licensePlate"), CONSTRAINT "PK_187fa17ba39d367e5604b3d1ec9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a654a0355ae4c5ba31c5f6c892" ON "vehicle" ("licensePlate") `,
    );
    await queryRunner.query(
      `CREATE TABLE "driver" ("id" SERIAL NOT NULL, "fullName" character varying NOT NULL, "phone" character varying NOT NULL, "licenseNumber" character varying, "licenseClass" character varying NOT NULL DEFAULT 'FC', "experienceYears" integer NOT NULL DEFAULT '5', "status" character varying NOT NULL DEFAULT 'AVAILABLE', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, CONSTRAINT "PK_61de71a8d217d585ecd5ee3d065" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_984e56357bfc26364c83cc5ce4" ON "driver" ("fullName") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_984e56357bfc26364c83cc5ce4"`,
    );
    await queryRunner.query(`DROP TABLE "driver"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a654a0355ae4c5ba31c5f6c892"`,
    );
    await queryRunner.query(`DROP TABLE "vehicle"`);
  }
}
