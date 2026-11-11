import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDailyRegionalDispatchReportTable1789130000000 implements MigrationInterface {
  name = 'CreateDailyRegionalDispatchReportTable1789130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Thêm cột destinationRegion vào bảng order
    await queryRunner.query(`
      ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "destinationRegion" character varying(50);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_destinationRegion" ON "order" ("destinationRegion");
    `);

    // 2. Tạo bảng daily_regional_dispatch_report
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "daily_regional_dispatch_report" (
        "id" SERIAL NOT NULL,
        "reportDate" character varying(10) NOT NULL,
        "hubId" integer NOT NULL,
        "region" character varying(50) NOT NULL,
        "onhandWeightKg" double precision NOT NULL DEFAULT 0,
        "onhandVolumeCbm" double precision NOT NULL DEFAULT 0,
        "onhandPackageCount" integer NOT NULL DEFAULT 0,
        "onhandOrderCount" integer NOT NULL DEFAULT 0,
        "incomingWeightKg" double precision NOT NULL DEFAULT 0,
        "incomingVolumeCbm" double precision NOT NULL DEFAULT 0,
        "incomingPackageCount" integer NOT NULL DEFAULT 0,
        "incomingTripCount" integer NOT NULL DEFAULT 0,
        "totalWeightKg" double precision NOT NULL DEFAULT 0,
        "totalVolumeCbm" double precision NOT NULL DEFAULT 0,
        "triggeredBy" character varying(30) NOT NULL DEFAULT 'CRON',
        "calculatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_daily_regional_dispatch_report_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_daily_regional_dispatch_report_date_hub_region" UNIQUE ("reportDate", "hubId", "region"),
        CONSTRAINT "FK_daily_regional_dispatch_report_hub" FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_date" ON "daily_regional_dispatch_report" ("reportDate");
      CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_hubId" ON "daily_regional_dispatch_report" ("hubId");
      CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_region" ON "daily_regional_dispatch_report" ("region");
    `);

    // 3. Backfill dữ liệu destinationRegion cho các đơn hàng cũ đã có province
    await queryRunner.query(`
      UPDATE "order"
      SET "destinationRegion" = CASE
        -- Miền Bắc (25 tỉnh/thành)
        WHEN province ~* 'hà nội|ha noi|hải phòng|hai phong|quảng ninh|bắc ninh|hải dương|hưng yên|vĩnh phúc|thái bình|nam định|hà nam|ninh bình|hà giang|cao bằng|bắc kạn|bac kan|tuyên quang|lào cai|yên bái|thái nguyên|lạng sơn|bắc giang|phú thọ|điện biên|lai châu|sơn la|hòa bình|hoà bình'
          THEN 'MIỀN BẮC'

        -- Miền Trung & Tây Nguyên (19 tỉnh/thành)
        WHEN province ~* 'thanh hóa|thanh hoá|nghệ an|hà tĩnh|quảng bình|quảng trị|huế|đà nẵng|quảng nam|quảng ngãi|bình định|phú yên|khánh hòa|khánh hoà|nha trang|ninh thuận|bình thuận|kon tum|gia lai|đắk lắk|đắc lắc|đắk nông|lâm đồng|đà lạt'
          THEN 'MIỀN TRUNG'

        -- Miền Nam (19 tỉnh/thành: Đông Nam Bộ & Toàn bộ Miền Tây)
        WHEN province ~* 'hồ chí minh|ho chi minh|hcm|sài gòn|bình dương|đồng nai|vũng tàu|bà rịa|tây ninh|bình phước|long an|tiền giang|bến tre|trà vinh|vĩnh long|đồng tháp|an giang|kiên giang|cần thơ|hậu giang|sóc trăng|bạc liêu|cà mau'
          THEN 'MIỀN NAM'

        ELSE 'N/A'
      END
      WHERE "province" IS NOT NULL AND ("destinationRegion" IS NULL OR "destinationRegion" = '');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "daily_regional_dispatch_report";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_destinationRegion";`,
    );
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN IF EXISTS "destinationRegion";`,
    );
  }
}
