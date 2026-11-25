import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegionToHub1789170000000 implements MigrationInterface {
  name = 'AddRegionToHub1789170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "hub"
      ADD COLUMN IF NOT EXISTS "region" character varying(20)
    `);

    await queryRunner.query(`
      UPDATE "hub"
      SET "region" = CASE
        WHEN "code" = 'HUB-HYN-01' OR "city" ILIKE ANY (ARRAY['%Hà Nội%', '%Hải Phòng%', '%Hưng Yên%', '%Bắc Ninh%', '%Quảng Ninh%', '%Ninh Bình%', '%Thái Nguyên%', '%Phú Thọ%', '%Lào Cai%', '%Tuyên Quang%', '%Lạng Sơn%', '%Cao Bằng%', '%Lai Châu%', '%Điện Biên%', '%Sơn La%']) THEN 'MIỀN BẮC'
        WHEN "code" = 'HUB-DAD-01' OR "city" ILIKE ANY (ARRAY['%Đà Nẵng%', '%Huế%', '%Thanh Hóa%', '%Nghệ An%', '%Hà Tĩnh%', '%Quảng Bình%', '%Quảng Trị%', '%Quảng Ngãi%', '%Gia Lai%', '%Khánh Hòa%', '%Đắk%', '%Đắc%', '%Lâm Đồng%', '%Ninh Thuận%', '%Bình Thuận%']) THEN 'MIỀN TRUNG'
        WHEN "code" = 'HUB-HCM-01' OR "city" ILIKE ANY (ARRAY['%Hồ Chí Minh%', '%HCM%', '%Cần Thơ%', '%Bình Dương%', '%Đồng Nai%', '%Bà Rịa%', '%Vũng Tàu%', '%Tây Ninh%', '%Bình Phước%', '%Long An%', '%Tiền Giang%', '%Bến Tre%', '%Trà Vinh%', '%Vĩnh Long%', '%Đồng Tháp%', '%An Giang%', '%Kiên Giang%', '%Hậu Giang%', '%Sóc Trăng%', '%Bạc Liêu%', '%Cà Mau%']) THEN 'MIỀN NAM'
        ELSE NULL
      END
      WHERE "region" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_hub_region" ON "hub" ("region")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_hub_region"`);
    await queryRunner.query(`ALTER TABLE "hub" DROP COLUMN IF EXISTS "region"`);
  }
}
