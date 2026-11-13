import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DailyHubOperationalReportEntity } from './infrastructure/persistence/relational/entities/daily-hub-operational-report.entity';
import { DailyRegionalDispatchReportEntity } from './infrastructure/persistence/relational/entities/daily-regional-dispatch-report.entity';
import { normalizeRegion, RegionEnum } from './utils/region-normalizer.util';
import { CronJobConfigEntity } from './infrastructure/persistence/relational/entities/cron-job-config.entity';
import { CronJobExecutionLogEntity } from './infrastructure/persistence/relational/entities/cron-job-execution-log.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { RoleEnum } from '../roles/roles.enum';
import { NotificationsService } from '../notifications/notifications.service';

export type ReportDirection = 'OUTBOUND' | 'INBOUND' | 'ALL';

export interface DirectionMetrics {
  cbm: number;
  weightTons: number;
  weightKg: number;
  tripCount: number;
  orderCount: number;
  packageCount: number;
}

export interface DailyReportPoint extends DirectionMetrics {
  reportDate: string;
  dayOfMonth: number;
  dayLabel: string;
  fullDateLabel: string;
  windowStart: string;
  windowEnd: string;
  windowLabel: string;
  isClosed: boolean;
  isFuture: boolean;
  triggeredBy: string;
  inbound: DirectionMetrics;
  outbound: DirectionMetrics;
}

export interface MonthlyReportPoint extends DirectionMetrics {
  monthKey: string;
  year: number;
  month: number;
  monthLabel: string;
  inbound: DirectionMetrics;
  outbound: DirectionMetrics;
}

export interface ConfirmedTripReportItem {
  tripCode: string;
  invoiceCode: string | null;
  reportDate: string;
  windowLabel: string;
  confirmedAt: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
  hubId: number;
  hubCode: string | null;
  hubName: string;
  hubLevel: number;
  licensePlate: string | null;
  driverName: string | null;
  orderCount: number;
  packageCount: number;
  weightKg: number;
  weightTons: number;
  volumeCbm: number;
}

/**
 * Shift in milliseconds from UTC to Operational Report Date:
 * Vietnam Time is UTC+7.
 * Since report day D runs from (D-1) 18:00 GMT+7 to D 18:00 GMT+7,
 * adding +6 hours to GMT+7 (= UTC + 13 hours) maps any timestamp in
 * [(D-1) 18:00:00+07:00, D 18:00:00+07:00) directly to calendar date D.
 */
const OPERATIONAL_DAY_SHIFT_MS = 1 * 60 * 60 * 1000;
const VN_TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

@Injectable()
export class AdminReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminReportsService.name);
  private cronTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private lastCronProcessedDate: string | null = null;
  private lastCronRunAt: Date | null = null;
  private isRunningCron = false;
  private tableEnsured = false;
  private defaultConfigsSeeded = false;
  private cachedActiveHubs: { hubs: HubEntity[]; expiresAt: number } | null =
    null;
  private actorEmailCache = new Map<number, string>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DailyHubOperationalReportEntity)
    private readonly reportRepository: Repository<DailyHubOperationalReportEntity>,
    @InjectRepository(DailyRegionalDispatchReportEntity)
    private readonly regionalReportRepository: Repository<DailyRegionalDispatchReportEntity>,
    @InjectRepository(CronJobConfigEntity)
    private readonly cronConfigRepository: Repository<CronJobConfigEntity>,
    @InjectRepository(CronJobExecutionLogEntity)
    private readonly cronLogRepository: Repository<CronJobExecutionLogEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    // Non-blocking startup initialization & daily 18:05 GMT+7 cron check
    this.startupTimer = setTimeout(() => {
      void this.initializeAndCheckDailyCron();
    }, 4000);
    this.startupTimer.unref();

    this.cronTimer = setInterval(() => {
      void this.checkAndRunScheduledCron();
    }, 60 * 1000);
    this.cronTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.cronTimer) {
      clearInterval(this.cronTimer);
      this.cronTimer = null;
    }
  }

  /**
   * Ensure the snapshot table exists (safe idempotent guard for environments where
   * migrations have not been manually run yet).
   */
  private async ensureTableExists(): Promise<void> {
    if (this.tableEnsured) return;
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "daily_hub_operational_report" (
          "id" SERIAL NOT NULL,
          "reportDate" character varying(10) NOT NULL,
          "windowStart" TIMESTAMP NOT NULL,
          "windowEnd" TIMESTAMP NOT NULL,
          "hubId" integer NOT NULL,
          "inboundVolumeCbm" double precision NOT NULL DEFAULT 0,
          "inboundWeightKg" double precision NOT NULL DEFAULT 0,
          "inboundPackageCount" integer NOT NULL DEFAULT 0,
          "inboundTripCount" integer NOT NULL DEFAULT 0,
          "inboundOrderCount" integer NOT NULL DEFAULT 0,
          "outboundVolumeCbm" double precision NOT NULL DEFAULT 0,
          "outboundWeightKg" double precision NOT NULL DEFAULT 0,
          "outboundPackageCount" integer NOT NULL DEFAULT 0,
          "outboundTripCount" integer NOT NULL DEFAULT 0,
          "outboundOrderCount" integer NOT NULL DEFAULT 0,
          "triggeredBy" character varying(30) NOT NULL DEFAULT 'CRON',
          "calculatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deletedAt" TIMESTAMP,
          CONSTRAINT "PK_daily_hub_operational_report_id" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_daily_hub_operational_report_date_hub" UNIQUE ("reportDate", "hubId"),
          CONSTRAINT "FK_daily_hub_operational_report_hub" FOREIGN KEY ("hubId") REFERENCES "hub"("id") ON DELETE CASCADE
        );
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_daily_hub_op_report_reportDate" ON "daily_hub_operational_report" ("reportDate");
        CREATE INDEX IF NOT EXISTS "IDX_daily_hub_op_report_hubId" ON "daily_hub_operational_report" ("hubId");
      `);
      await this.dataSource.query(`
        ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "destinationRegion" character varying(50);
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_order_destinationRegion" ON "order" ("destinationRegion");
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "daily_regional_dispatch_report" (
          "id" SERIAL NOT NULL,
          "reportDate" character varying(10) NOT NULL,
          "hubId" integer NOT NULL,
          "region" character varying(50) NOT NULL,
          "onhandWeightKg" double precision NOT NULL DEFAULT 0,
          "onhandVolumeCbm" double precision NOT NULL DEFAULT 0,
          "onhandPackageCount" integer NOT NULL DEFAULT 0,
          "onhandOrderCount" integer NOT NULL DEFAULT 0,
          "draftWeightKg" double precision NOT NULL DEFAULT 0,
          "draftVolumeCbm" double precision NOT NULL DEFAULT 0,
          "draftOrderCount" integer NOT NULL DEFAULT 0,
          "onhandOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "draftOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
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
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_date" ON "daily_regional_dispatch_report" ("reportDate");
        CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_hubId" ON "daily_regional_dispatch_report" ("hubId");
        CREATE INDEX IF NOT EXISTS "IDX_daily_regional_report_region" ON "daily_regional_dispatch_report" ("region");
      `);
      await this.dataSource.query(`
        ALTER TABLE "daily_regional_dispatch_report"
          ADD COLUMN IF NOT EXISTS "draftWeightKg" double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "draftVolumeCbm" double precision NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "draftOrderCount" integer NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "onhandOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS "draftOrderCodes" jsonb NOT NULL DEFAULT '[]'::jsonb;
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "cron_job_config" (
          "id" SERIAL NOT NULL,
          "jobKey" character varying(80) NOT NULL,
          "name" character varying(150) NOT NULL,
          "description" text,
          "isEnabled" boolean NOT NULL DEFAULT true,
          "cronTime" character varying(5) NOT NULL DEFAULT '18:05',
          "cutoffHour" integer NOT NULL DEFAULT 18,
          "notifySuperAdmins" boolean NOT NULL DEFAULT true,
          "lastRunAt" TIMESTAMP,
          "lastRunStatus" character varying(20),
          "lastReportDate" character varying(10),
          "updatedByUserId" integer,
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deletedAt" TIMESTAMP,
          CONSTRAINT "PK_cron_job_config_id" PRIMARY KEY ("id"),
          CONSTRAINT "UQ_cron_job_config_jobKey" UNIQUE ("jobKey")
        );
      `);
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS "cron_job_execution_log" (
          "id" SERIAL NOT NULL,
          "jobKey" character varying(80) NOT NULL,
          "targetDate" character varying(10) NOT NULL,
          "targetEndDate" character varying(10) NOT NULL,
          "windowLabel" character varying(120) NOT NULL,
          "triggeredBy" character varying(30) NOT NULL,
          "actorUserId" integer,
          "actorEmail" character varying(255),
          "status" character varying(20) NOT NULL DEFAULT 'SUCCESS',
          "processedDays" integer NOT NULL DEFAULT 1,
          "upsertedHubRows" integer NOT NULL DEFAULT 0,
          "totalInboundCbm" double precision NOT NULL DEFAULT 0,
          "totalInboundTons" double precision NOT NULL DEFAULT 0,
          "totalInboundTrips" integer NOT NULL DEFAULT 0,
          "totalOutboundCbm" double precision NOT NULL DEFAULT 0,
          "totalOutboundTons" double precision NOT NULL DEFAULT 0,
          "totalOutboundTrips" integer NOT NULL DEFAULT 0,
          "durationMs" integer NOT NULL DEFAULT 0,
          "errorMessage" text,
          "startedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "finishedAt" TIMESTAMP,
          "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "deletedAt" TIMESTAMP,
          CONSTRAINT "PK_cron_job_execution_log_id" PRIMARY KEY ("id")
        );
      `);
      await this.dataSource.query(`
        INSERT INTO "cron_job_config" ("jobKey", "name", "description", "isEnabled", "cronTime", "cutoffHour", "notifySuperAdmins")
        VALUES
          (
            'DAILY_HUB_OPERATIONAL_REPORT',
            'Tổng hợp Báo cáo Vận hành Hub Hàng ngày',
            'Tự động chốt sản lượng CBM, Số Tấn và Chuyến xe (TRIP) xác nhận Nhập/Xuất theo chu kỳ 06:00 (6:00 AM) ngày D → 05:59 (5:59 AM) ngày D+1',
            true,
            '18:05',
            18,
            true
          ),
          (
            'PENDING_DRAFT_TRIPS_CUTOFF_REMINDER',
            'Cảnh báo Chuyến xe Nháp chưa xác nhận trước Cut-off 18:00',
            'Rà soát toàn bộ chuyến xe (TRIP) đang ở trạng thái Chờ xử lý / Nháp (PENDING) chưa xác nhận Nhập/Xuất kho trước giờ chốt sổ 18:00 hàng ngày',
            true,
            '17:30',
            18,
            true
          ),
          (
            'STALE_WAREHOUSE_INVENTORY_AUDIT',
            'Kiểm toán Vận đơn Tồn kho Quá hạn & Đối soát Sổ cái Hub',
            'Đối soát tự động tồn kho khả dụng tại các Hub Cấp 1 & Trạm Xe Bo Cấp 2, phát hiện đơn hàng lưu kho quá 48 giờ chưa phân bổ chuyến xuất',
            true,
            '08:00',
            18,
            false
          )
        ON CONFLICT ("jobKey") DO NOTHING;
      `);
      this.tableEnsured = true;
    } catch (err) {
      this.logger.warn(
        `[AdminReportsService] ensureTableExists warning: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Convert a UTC Date into Vietnam local date parts (GMT+7).
   */
  private getVietnamDateParts(now: Date = new Date()): {
    dateStr: string;
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  } {
    const vnTime = new Date(now.getTime() + VN_TZ_OFFSET_MS);
    const iso = vnTime.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ in GMT+7
    const dateStr = iso.slice(0, 10);
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const day = Number(iso.slice(8, 10));
    const hour = Number(iso.slice(11, 13));
    const minute = Number(iso.slice(14, 16));
    return { dateStr, year, month, day, hour, minute };
  }

  /**
   * Shift a YYYY-MM-DD string by `deltaDays` days.
   */
  public addDays(dateStr: string, deltaDays: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Determine the operational `reportDate` (YYYY-MM-DD) for any confirmation timestamp.
   * Example:
   * - 2026-11-01 18:00:00+07:00 -> '2026-11-02'
   * - 2026-11-02 17:59:59+07:00 -> '2026-11-02'
   * - 2026-11-02 18:00:00+07:00 -> '2026-11-03'
   */
  public getOperationalReportDateForTimestamp(ts: Date = new Date()): string {
    const shifted = new Date(ts.getTime() + OPERATIONAL_DAY_SHIFT_MS);
    return shifted.toISOString().slice(0, 10);
  }

  /**
   * Get the latest reportDate whose 18:00 GMT+7 window has already closed.
   * If current VN time is >= 18:00 on day D, then day D's report window (D-1 18:00 -> D 18:00) is closed!
   * If current VN time is < 18:00 on day D, then day (D-1)'s report window is the latest closed one.
   */
  public getLatestClosedReportDate(now: Date = new Date()): string {
    const vn = this.getVietnamDateParts(now);
    if (vn.hour >= 6) {
      return this.addDays(vn.dateStr, -1);
    }
    return this.addDays(vn.dateStr, -2);
  }

  /**
   * Compute exact UTC [windowStart, windowEnd) for a given reportDate YYYY-MM-DD.
   * Chu kỳ mới: từ 06:00 ngày D đến 05:59 ngày D+1.
   * Ví dụ: reportDate = '2026-11-09' thì:
   *   windowStart = '2026-11-09T06:00:00+07:00' ('2026-11-08T23:00:00.000Z')
   *   windowEnd   = '2026-11-10T06:00:00+07:00' ('2026-11-09T23:00:00.000Z')
   *   windowLabel = '06:00 09/11/2026 → 05:59 10/11/2026'
   */
  public getReportWindow(reportDate: string): {
    windowStart: Date;
    windowEnd: Date;
    prevDateStr: string;
    nextDateStr: string;
    windowLabel: string;
  } {
    const nextDateStr = this.addDays(reportDate, 1);
    const prevDateStr = this.addDays(reportDate, -1);
    const windowStart = new Date(`${reportDate}T06:00:00+07:00`);
    const windowEnd = new Date(`${nextDateStr}T06:00:00+07:00`);
    const formatVnDate = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    const windowLabel = `06:00 ${formatVnDate(reportDate)} → 05:59 ${formatVnDate(nextDateStr)}`;
    return { windowStart, windowEnd, prevDateStr, nextDateStr, windowLabel };
  }

  private async getOrCreateDefaultCronConfig(
    requestedJobKey = 'DAILY_HUB_OPERATIONAL_REPORT',
  ): Promise<CronJobConfigEntity> {
    await this.ensureTableExists();
    const defaultSeeds: Array<{
      jobKey: string;
      name: string;
      description: string;
      isEnabled: boolean;
      cronTime: string;
      cutoffHour: number;
      notifySuperAdmins: boolean;
    }> = [
      {
        jobKey: 'DAILY_HUB_OPERATIONAL_REPORT',
        name: 'Tổng hợp Báo cáo Vận hành Hub Hàng ngày',
        description:
          'Tự động chốt sản lượng CBM, Số Tấn và Chuyến xe (TRIP) xác nhận Nhập/Xuất theo chu kỳ 06:00 (6:00 AM) ngày D → 05:59 (5:59 AM) ngày D+1',
        isEnabled: true,
        cronTime: '18:05',
        cutoffHour: 18,
        notifySuperAdmins: true,
      },
      {
        jobKey: 'PENDING_DRAFT_TRIPS_CUTOFF_REMINDER',
        name: 'Cảnh báo Chuyến xe Nháp chưa xác nhận trước Cut-off 18:00',
        description:
          'Rà soát toàn bộ chuyến xe (TRIP) đang ở trạng thái Chờ xử lý / Nháp (PENDING) chưa xác nhận Nhập/Xuất kho trước giờ chốt sổ 18:00 hàng ngày',
        isEnabled: true,
        cronTime: '17:30',
        cutoffHour: 18,
        notifySuperAdmins: true,
      },
      {
        jobKey: 'STALE_WAREHOUSE_INVENTORY_AUDIT',
        name: 'Kiểm toán Vận đơn Tồn kho Quá hạn & Đối soát Sổ cái Hub',
        description:
          'Đối soát tự động tồn kho khả dụng tại các Hub Cấp 1 & Trạm Xe Bo Cấp 2, phát hiện đơn hàng lưu kho quá 48 giờ chưa phân bổ chuyến xuất',
        isEnabled: true,
        cronTime: '08:00',
        cutoffHour: 18,
        notifySuperAdmins: false,
      },
      {
        jobKey: 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT',
        name: 'Cân đối Tải trọng Đội xe theo Miền (Bắc - Trung - Nam)',
        description:
          'Định kỳ quét tồn kho khả dụng và các chuyến xe trung chuyển đang trên đường để tổng hợp sản lượng tải trọng theo 3 miền (Bắc, Trung, Nam) phục vụ điều phối đội xe',
        isEnabled: true,
        cronTime: '17:00',
        cutoffHour: 18,
        notifySuperAdmins: true,
      },
    ];

    if (!this.defaultConfigsSeeded) {
      for (const seed of defaultSeeds) {
        const existing = await this.cronConfigRepository.findOne({
          where: { jobKey: seed.jobKey },
        });
        if (!existing) {
          await this.cronConfigRepository.save(
            this.cronConfigRepository.create(seed),
          );
        }
      }
      this.defaultConfigsSeeded = true;
    }

    const targetKey = requestedJobKey?.trim() || 'DAILY_HUB_OPERATIONAL_REPORT';
    const found = await this.cronConfigRepository.findOne({
      where: { jobKey: targetKey },
    });
    if (found) {
      return found;
    }
    return (await this.cronConfigRepository.findOne({
      where: { jobKey: 'DAILY_HUB_OPERATIONAL_REPORT' },
    })) as CronJobConfigEntity;
  }

  private async initializeAndCheckDailyCron(): Promise<void> {
    try {
      await this.ensureTableExists();
      await this.getOrCreateDefaultCronConfig();
    } catch (err) {
      this.logger.warn(
        `[CRON INIT] Lỗi khởi tạo cron báo cáo: ${(err as Error)?.message}`,
      );
    }
  }

  /**
   * Triggered every 60s. Checks DB config (`cron_job_config.isEnabled` & `cronTime` in GMT+7).
   * When Vietnam time reaches the configured daily time and today's closed reportDate
   * hasn't been processed by the daily cron yet, runs the aggregation and logs the execution.
   */
  private async checkAndRunScheduledCron(): Promise<void> {
    if (this.isRunningCron) return;
    try {
      const config = await this.getOrCreateDefaultCronConfig();
      if (!config.isEnabled) return;

      const [cfgHourStr, cfgMinStr] = (config.cronTime || '18:05').split(':');
      const cfgHour = Number(cfgHourStr) || 18;
      const cfgMin = Number(cfgMinStr) || 5;

      const now = new Date();
      const vn = this.getVietnamDateParts(now);

      if (vn.hour === cfgHour && vn.minute >= cfgMin) {
        const targetReportDate = this.getLatestClosedReportDate(now);
        if (this.lastCronProcessedDate === targetReportDate) {
          return;
        }

        this.isRunningCron = true;
        try {
          const { windowEnd } = this.getReportWindow(targetReportDate);
          const alreadyRanAfterCutoff = await this.cronLogRepository
            .createQueryBuilder('l')
            .where('l.targetDate = :targetDate', {
              targetDate: targetReportDate,
            })
            .andWhere('l.triggeredBy = :triggeredBy', {
              triggeredBy: 'CRON_SCHEDULED',
            })
            .andWhere('l.startedAt >= :windowEnd', { windowEnd })
            .andWhere('l.status = :status', { status: 'SUCCESS' })
            .getCount();

          if (alreadyRanAfterCutoff === 0) {
            this.logger.log(
              `[DAILY CRON ${config.cronTime}] Bắt đầu tổng hợp báo cáo vận hành ngày ${targetReportDate} (18:00 ${this.addDays(targetReportDate, -1)} -> 18:00 ${targetReportDate})`,
            );
            await this.executeAndLogCronRun({
              fromDate: targetReportDate,
              toDate: targetReportDate,
              triggeredBy: 'CRON_SCHEDULED',
              notifySuperAdmins: config.notifySuperAdmins,
            });
          }
          this.lastCronProcessedDate = targetReportDate;
          this.lastCronRunAt = new Date();
        } catch (err) {
          this.logger.error(
            `[DAILY CRON] Lỗi chạy báo cáo ngày ${targetReportDate}: ${(err as Error)?.message}`,
          );
        } finally {
          this.isRunningCron = false;
        }
      }

      // ── 2. Kiểm tra và kích hoạt Cronjob Tải trọng Đội xe theo Miền ──
      const regionalConfig = await this.cronConfigRepository.findOne({
        where: { jobKey: 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT' },
      });
      if (regionalConfig && regionalConfig.isEnabled) {
        const [regH, regM] = (regionalConfig.cronTime || '17:00')
          .split(':')
          .map(Number);
        if (vn.hour === regH && vn.minute >= regM) {
          const todayDate = `${vn.year}-${String(vn.month).padStart(2, '0')}-${String(vn.day).padStart(2, '0')}`;
          if (regionalConfig.lastReportDate !== todayDate) {
            this.logger.log(
              `[REGIONAL CRON ${regionalConfig.cronTime}] Đang chạy tổng hợp snapshot tải trọng đội xe ngày ${todayDate}...`,
            );
            const startTime = Date.now();
            await this.calculateRegionalDispatchSnapshot({
              date: todayDate,
              triggeredBy: 'CRON',
            });
            const durationMs = Date.now() - startTime;
            regionalConfig.lastReportDate = todayDate;
            regionalConfig.lastRunAt = new Date();
            regionalConfig.lastRunStatus = 'SUCCESS';
            await this.cronConfigRepository.save(regionalConfig);

            await this.cronLogRepository.save(
              this.cronLogRepository.create({
                jobKey: 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT',
                targetDate: todayDate,
                targetEndDate: todayDate,
                windowLabel: `Snapshot tải trọng đội xe ngày ${todayDate}`,
                triggeredBy: 'CRON_SCHEDULED',
                startedAt: new Date(startTime),
                finishedAt: new Date(),
                durationMs,
                status: 'SUCCESS',
              }),
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(`[DAILY CRON CHECK] ${(err as Error)?.message}`);
    }
  }

  /**
   * Non-blocking hook called when a trip is confirmed or rolled back so the snapshot table
   * stays 100% synchronized in real time.
   */
  public triggerAsyncRefreshForTimestamps(
    timestamps: Array<Date | null | undefined>,
  ): void {
    const validDates = Array.from(
      new Set(
        timestamps
          .filter(
            (t): t is Date => t instanceof Date && !Number.isNaN(t.getTime()),
          )
          .map((t) => this.getOperationalReportDateForTimestamp(t)),
      ),
    ).sort();

    if (validDates.length === 0) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          for (const d of validDates) {
            await this.aggregateAndSaveDateRange(d, d, 'AUTO_SYNC', false);
          }
        } catch (err) {
          this.logger.warn(
            `[AUTO_SYNC] Không thể cập nhật nhanh báo cáo ngày ${validDates.join(', ')}: ${(err as Error)?.message}`,
          );
        }
      })();
    }, 200);
    timer.unref();
  }

  /**
   * Aggregate confirmed transactions in `[fromDate, toDate]` (where each day D is
   * `[D-1 18:00+07:00, D 18:00+07:00)`) across all active Hubs and upsert into
   * `daily_hub_operational_report`.
   */
  public async aggregateAndSaveDateRange(
    fromDate: string,
    toDate: string,
    triggeredBy: 'CRON' | 'MANUAL' | 'BACKFILL' | 'AUTO_SYNC' = 'MANUAL',
    notifySuperAdmins = false,
  ): Promise<{
    processedDays: number;
    upsertedRows: number;
    fromDate: string;
    toDate: string;
  }> {
    await this.ensureTableExists();

    const startWindow = this.getReportWindow(fromDate).windowStart;
    const endWindow = this.getReportWindow(toDate).windowEnd;

    const nowMs = Date.now();
    if (!this.cachedActiveHubs || this.cachedActiveHubs.expiresAt < nowMs) {
      const fetchedHubs = await this.hubRepository.find({
        where: { isActive: true },
        order: { level: 'ASC', id: 'ASC' },
      });
      this.cachedActiveHubs = { hubs: fetchedHubs, expiresAt: nowMs + 60000 };
    }
    const activeHubs = this.cachedActiveHubs.hubs;

    if (activeHubs.length === 0) {
      return { processedDays: 0, upsertedRows: 0, fromDate, toDate };
    }

    // Query all confirmed inventory transactions in [startWindow, endWindow)
    // Bucketed by operational reportDate = TO_CHAR(tx."createdAt" + INTERVAL '1 hour', 'YYYY-MM-DD')
    // Strictly excludes draft trips (which have no inventory transactions) and soft-deleted/rolled-back transactions.
    const rawAggRows: Array<{
      reportDate: string;
      hubId: number;
      inboundVolumeCbm: number;
      inboundWeightKg: number;
      inboundPackageCount: number;
      inboundTripCount: number;
      inboundOrderCount: number;
      outboundVolumeCbm: number;
      outboundWeightKg: number;
      outboundPackageCount: number;
      outboundTripCount: number;
      outboundOrderCount: number;
    }> = await this.dataSource.query(
      `
      WITH tx_enriched AS (
        SELECT
          TO_CHAR(tx."createdAt" + INTERVAL '1 hour', 'YYYY-MM-DD') AS "reportDate",
          COALESCE(tx."hubId", o."originHubId", o."currentHubId") AS "resolvedHubId",
          tx."type" AS "txType",
          tx."orderId" AS "orderId",
          COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), tx.id::text) AS "tripKey",
          COALESCE(tx."quantity", 0)::int AS "qty",
          CASE
            WHEN COALESCE(tx."volume", 0) > 0 THEN tx."volume"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalVolume", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END AS "effVolume",
          CASE
            WHEN COALESCE(tx."weight", 0) > 0 THEN tx."weight"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalWeight", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END AS "effWeight"
        FROM "order_inventory_transaction" tx
        INNER JOIN "order" o ON o.id = tx."orderId" AND o."deletedAt" IS NULL
        WHERE tx."deletedAt" IS NULL
          AND tx."type" IN ('INBOUND', 'OUTBOUND', 'TRANSFER')
          AND tx."createdAt" >= $1
          AND tx."createdAt" < $2
      )
      SELECT
        "reportDate",
        "resolvedHubId"::int AS "hubId",
        COALESCE(SUM("effVolume") FILTER (WHERE "txType" = 'INBOUND'), 0)::float AS "inboundVolumeCbm",
        COALESCE(SUM("effWeight") FILTER (WHERE "txType" = 'INBOUND'), 0)::float AS "inboundWeightKg",
        COALESCE(SUM("qty") FILTER (WHERE "txType" = 'INBOUND'), 0)::int AS "inboundPackageCount",
        COUNT(DISTINCT "tripKey") FILTER (WHERE "txType" = 'INBOUND')::int AS "inboundTripCount",
        COUNT(DISTINCT "orderId") FILTER (WHERE "txType" = 'INBOUND')::int AS "inboundOrderCount",
        COALESCE(SUM("effVolume") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::float AS "outboundVolumeCbm",
        COALESCE(SUM("effWeight") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::float AS "outboundWeightKg",
        COALESCE(SUM("qty") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::int AS "outboundPackageCount",
        COUNT(DISTINCT "tripKey") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER'))::int AS "outboundTripCount",
        COUNT(DISTINCT "orderId") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER'))::int AS "outboundOrderCount"
      FROM tx_enriched
      WHERE "resolvedHubId" IS NOT NULL
      GROUP BY "reportDate", "resolvedHubId"
      `,
      [startWindow.toISOString(), endWindow.toISOString()],
    );

    const aggMap = new Map<string, (typeof rawAggRows)[number]>();
    for (const r of rawAggRows) {
      aggMap.set(`${r.reportDate}:${r.hubId}`, r);
    }

    const datesList = this.enumerateDates(fromDate, toDate);
    let upsertedRows = 0;

    const rowsToUpsert: Array<any[]> = [];
    for (const d of datesList) {
      const { windowStart, windowEnd } = this.getReportWindow(d);
      const wsIso = windowStart.toISOString();
      const weIso = windowEnd.toISOString();
      for (const hub of activeHubs) {
        const found = aggMap.get(`${d}:${hub.id}`);
        const inboundVolumeCbm =
          Math.round((Number(found?.inboundVolumeCbm) || 0) * 1000) / 1000;
        const inboundWeightKg =
          Math.round((Number(found?.inboundWeightKg) || 0) * 1000) / 1000;
        const inboundPackageCount = Number(found?.inboundPackageCount) || 0;
        const inboundTripCount = Number(found?.inboundTripCount) || 0;
        const inboundOrderCount = Number(found?.inboundOrderCount) || 0;

        const outboundVolumeCbm =
          Math.round((Number(found?.outboundVolumeCbm) || 0) * 1000) / 1000;
        const outboundWeightKg =
          Math.round((Number(found?.outboundWeightKg) || 0) * 1000) / 1000;
        const outboundPackageCount = Number(found?.outboundPackageCount) || 0;
        const outboundTripCount = Number(found?.outboundTripCount) || 0;
        const outboundOrderCount = Number(found?.outboundOrderCount) || 0;

        rowsToUpsert.push([
          d,
          wsIso,
          weIso,
          hub.id,
          inboundVolumeCbm,
          inboundWeightKg,
          inboundPackageCount,
          inboundTripCount,
          inboundOrderCount,
          outboundVolumeCbm,
          outboundWeightKg,
          outboundPackageCount,
          outboundTripCount,
          outboundOrderCount,
          triggeredBy,
        ]);
      }
    }

    const chunkSize = 150;
    for (let i = 0; i < rowsToUpsert.length; i += chunkSize) {
      const chunk = rowsToUpsert.slice(i, i + chunkSize);
      const valuesSql: string[] = [];
      const flatParams: any[] = [];
      let pIdx = 1;
      for (const row of chunk) {
        const placeholders: string[] = [];
        for (const val of row) {
          placeholders.push(`$${pIdx++}`);
          flatParams.push(val);
        }
        valuesSql.push(
          `(${placeholders.join(', ')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        );
      }

      await this.dataSource.query(
        `
        INSERT INTO "daily_hub_operational_report" (
          "reportDate",
          "windowStart",
          "windowEnd",
          "hubId",
          "inboundVolumeCbm",
          "inboundWeightKg",
          "inboundPackageCount",
          "inboundTripCount",
          "inboundOrderCount",
          "outboundVolumeCbm",
          "outboundWeightKg",
          "outboundPackageCount",
          "outboundTripCount",
          "outboundOrderCount",
          "triggeredBy",
          "calculatedAt",
          "updatedAt"
        ) VALUES ${valuesSql.join(', ')}
        ON CONFLICT ("reportDate", "hubId") DO UPDATE SET
          "windowStart" = EXCLUDED."windowStart",
          "windowEnd" = EXCLUDED."windowEnd",
          "inboundVolumeCbm" = EXCLUDED."inboundVolumeCbm",
          "inboundWeightKg" = EXCLUDED."inboundWeightKg",
          "inboundPackageCount" = EXCLUDED."inboundPackageCount",
          "inboundTripCount" = EXCLUDED."inboundTripCount",
          "inboundOrderCount" = EXCLUDED."inboundOrderCount",
          "outboundVolumeCbm" = EXCLUDED."outboundVolumeCbm",
          "outboundWeightKg" = EXCLUDED."outboundWeightKg",
          "outboundPackageCount" = EXCLUDED."outboundPackageCount",
          "outboundTripCount" = EXCLUDED."outboundTripCount",
          "outboundOrderCount" = EXCLUDED."outboundOrderCount",
          "triggeredBy" = EXCLUDED."triggeredBy",
          "calculatedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP,
          "deletedAt" = NULL
        `,
        flatParams,
      );
      upsertedRows += chunk.length;
    }

    if (triggeredBy === 'CRON' || triggeredBy === 'MANUAL') {
      this.lastCronRunAt = new Date();
    }

    if (notifySuperAdmins && datesList.length > 0) {
      const targetDate = datesList[datesList.length - 1];
      await this.notifySuperAdminsForDailyReport(targetDate);
    }

    return {
      processedDays: datesList.length,
      upsertedRows,
      fromDate,
      toDate,
    };
  }

  /**
   * Send an In-App Notification to all active SUPER_ADMIN users when the daily report is finalized.
   */
  private async notifySuperAdminsForDailyReport(
    reportDate: string,
  ): Promise<void> {
    try {
      const superAdmins = await this.userRepository.find({
        where: { role: { id: RoleEnum.SUPER_ADMIN } },
      });
      if (superAdmins.length === 0) return;

      const rows = await this.reportRepository.find({
        where: { reportDate },
      });
      const totalOutCbm =
        Math.round(
          rows.reduce((s, r) => s + (Number(r.outboundVolumeCbm) || 0), 0) * 10,
        ) / 10;
      const totalOutTons =
        Math.round(
          (rows.reduce((s, r) => s + (Number(r.outboundWeightKg) || 0), 0) /
            1000) *
            100,
        ) / 100;
      const totalInCbm =
        Math.round(
          rows.reduce((s, r) => s + (Number(r.inboundVolumeCbm) || 0), 0) * 10,
        ) / 10;
      const totalInTons =
        Math.round(
          (rows.reduce((s, r) => s + (Number(r.inboundWeightKg) || 0), 0) /
            1000) *
            100,
        ) / 100;

      const { windowLabel } = this.getReportWindow(reportDate);
      const [y, m, d] = reportDate.split('-');
      const vnDateLabel = `${d}/${m}/${y}`;
      const title = `Báo cáo vận hành ngày ${vnDateLabel} đã chốt`;
      const body = `Khung giờ ${windowLabel}: Xuất kho ${totalOutCbm} CBM (${totalOutTons} tấn) • Nhập kho ${totalInCbm} CBM (${totalInTons} tấn).`;

      for (const admin of superAdmins) {
        const existingNotif: Array<{ id: number }> =
          await this.dataSource.query(
            `SELECT id FROM "notification" WHERE "userId" = $1 AND "title" = $2 LIMIT 1`,
            [admin.id, title],
          );
        if (existingNotif.length > 0) continue;

        await this.notificationsService.create({
          userId: admin.id,
          title,
          body,
          type: 'WAREHOUSE',
          metadata: {
            reportDate,
            windowLabel,
            url: `/dashboard/admin/reports?fromDate=${reportDate.slice(0, 8)}01&toDate=${reportDate}`,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        `[AdminReportsService] Không thể gửi thông báo báo cáo ngày ${reportDate}: ${(err as Error)?.message}`,
      );
    }
  }

  public enumerateDates(fromDate: string, toDate: string): string[] {
    const result: string[] = [];
    let curr = fromDate;
    let safety = 0;
    while (curr <= toDate && safety < 400) {
      result.push(curr);
      curr = this.addDays(curr, 1);
      safety++;
    }
    return result;
  }

  private sanitizeDateParam(val: string | undefined, fallback: string): string {
    if (!val || !/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
      return fallback;
    }
    return val.trim();
  }

  private pickDirectionMetrics(
    inbound: DirectionMetrics,
    outbound: DirectionMetrics,
    direction: ReportDirection,
  ): DirectionMetrics {
    if (direction === 'INBOUND') {
      return { ...inbound };
    }
    if (direction === 'OUTBOUND') {
      return { ...outbound };
    }
    const weightKg =
      Math.round((inbound.weightKg + outbound.weightKg) * 100) / 100;
    return {
      cbm: Math.round((inbound.cbm + outbound.cbm) * 10) / 10,
      weightKg,
      weightTons: Math.round((weightKg / 1000) * 100) / 100,
      tripCount: inbound.tripCount + outbound.tripCount,
      orderCount: inbound.orderCount + outbound.orderCount,
      packageCount: inbound.packageCount + outbound.packageCount,
    };
  }

  /**
   * Main Super Admin report query:
   * 1. Auto-backfills any missing days in the requested range (and trailing 5-6 months for Slide 3)
   *    into `daily_hub_operational_report`, plus refreshes the currently open operational day.
   * 2. Returns:
   *    - Slide 2 daily bar chart series + total CBM + average CBM/day
   *    - Slide 3 monthly trend line series (SỐ KHỐI & SỐ TẤN across trailing months)
   *    - Hub breakdown & confirmed trip drill-down list
   */
  public async getOperationalReport(query?: {
    fromDate?: string;
    toDate?: string;
    hubId?: number | string;
    direction?: string;
    monthsCount?: number;
  }) {
    await this.ensureTableExists();

    const now = new Date();
    const vnNow = this.getVietnamDateParts(now);
    const defaultFromDate = `${vnNow.dateStr.slice(0, 8)}01`;
    const lastDayOfCurrentMonth = new Date(Date.UTC(vnNow.year, vnNow.month, 0))
      .toISOString()
      .slice(0, 10);

    let fromDate = this.sanitizeDateParam(query?.fromDate, defaultFromDate);
    let toDate = this.sanitizeDateParam(query?.toDate, lastDayOfCurrentMonth);
    if (fromDate > toDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    // Cap maximum date range span at 366 days for safety
    const maxToDate = this.addDays(fromDate, 366);
    if (toDate > maxToDate) {
      toDate = maxToDate;
    }

    const rawDir = String(query?.direction || 'INBOUND').toUpperCase();
    const direction: ReportDirection =
      rawDir === 'OUTBOUND' || rawDir === 'ALL' ? rawDir : 'INBOUND';

    const hubId =
      query?.hubId && String(query.hubId).toUpperCase() !== 'ALL'
        ? Number(query.hubId) || null
        : null;

    // Determine trailing months range for Slide 3 (at least 5 months ending at toDate's month)
    const monthsCount = Math.max(
      5,
      Math.min(12, Number(query?.monthsCount) || 5),
    );
    const toYear = Number(toDate.slice(0, 4));
    const toMonth = Number(toDate.slice(5, 7));
    const trailingStartMonthDate = new Date(
      Date.UTC(toYear, toMonth - monthsCount, 1),
    )
      .toISOString()
      .slice(0, 10);
    const overallQueryStart =
      trailingStartMonthDate < fromDate ? trailingStartMonthDate : fromDate;
    const latestClosedReportDate = this.getLatestClosedReportDate(now);

    // Read strictly from daily_hub_operational_report (populated by Cronjob runs)

    const allHubs = await this.hubRepository.find({
      where: { isActive: true },
      order: { level: 'ASC', id: 'ASC' },
    });
    const selectedHub = hubId
      ? allHubs.find((h) => h.id === hubId) || null
      : null;

    // 1. Query daily rows from snapshot table for [overallQueryStart, toDate]
    const snapshotParams: any[] = [overallQueryStart, toDate];
    let hubFilterSql = '';
    if (hubId) {
      snapshotParams.push(hubId);
      hubFilterSql = `AND r."hubId" = $${snapshotParams.length}`;
    }

    const dailyDbRows: Array<{
      reportDate: string;
      inboundVolumeCbm: number;
      inboundWeightKg: number;
      inboundPackageCount: number;
      inboundTripCount: number;
      inboundOrderCount: number;
      outboundVolumeCbm: number;
      outboundWeightKg: number;
      outboundPackageCount: number;
      outboundTripCount: number;
      outboundOrderCount: number;
      triggeredBy: string;
    }> = await this.dataSource.query(
      `
      SELECT
        r."reportDate" AS "reportDate",
        COALESCE(SUM(r."inboundVolumeCbm"), 0)::float AS "inboundVolumeCbm",
        COALESCE(SUM(r."inboundWeightKg"), 0)::float AS "inboundWeightKg",
        COALESCE(SUM(r."inboundPackageCount"), 0)::int AS "inboundPackageCount",
        COALESCE(SUM(r."inboundTripCount"), 0)::int AS "inboundTripCount",
        COALESCE(SUM(r."inboundOrderCount"), 0)::int AS "inboundOrderCount",
        COALESCE(SUM(r."outboundVolumeCbm"), 0)::float AS "outboundVolumeCbm",
        COALESCE(SUM(r."outboundWeightKg"), 0)::float AS "outboundWeightKg",
        COALESCE(SUM(r."outboundPackageCount"), 0)::int AS "outboundPackageCount",
        COALESCE(SUM(r."outboundTripCount"), 0)::int AS "outboundTripCount",
        COALESCE(SUM(r."outboundOrderCount"), 0)::int AS "outboundOrderCount",
        MAX(r."triggeredBy") AS "triggeredBy"
      FROM "daily_hub_operational_report" r
      WHERE r."deletedAt" IS NULL
        AND r."reportDate" >= $1
        AND r."reportDate" <= $2
        ${hubFilterSql}
      GROUP BY r."reportDate"
      ORDER BY r."reportDate" ASC
      `,
      snapshotParams,
    );

    const dailyMap = new Map<string, (typeof dailyDbRows)[number]>();
    for (const row of dailyDbRows) {
      dailyMap.set(row.reportDate, row);
    }

    // 2. Build Slide 2: Daily series across [fromDate, toDate]
    const rangeDates = this.enumerateDates(fromDate, toDate);
    const sameMonthInRange = fromDate.slice(0, 7) === toDate.slice(0, 7);

    const dailySeries: DailyReportPoint[] = rangeDates.map((d) => {
      const dbRow = dailyMap.get(d);
      const { windowStart, windowEnd, windowLabel } = this.getReportWindow(d);
      const inboundWeightKg =
        Math.round((Number(dbRow?.inboundWeightKg) || 0) * 100) / 100;
      const inbound: DirectionMetrics = {
        cbm: Math.round((Number(dbRow?.inboundVolumeCbm) || 0) * 10) / 10,
        weightKg: inboundWeightKg,
        weightTons: Math.round((inboundWeightKg / 1000) * 100) / 100,
        tripCount: Number(dbRow?.inboundTripCount) || 0,
        orderCount: Number(dbRow?.inboundOrderCount) || 0,
        packageCount: Number(dbRow?.inboundPackageCount) || 0,
      };

      const outboundWeightKg =
        Math.round((Number(dbRow?.outboundWeightKg) || 0) * 100) / 100;
      const outbound: DirectionMetrics = {
        cbm: Math.round((Number(dbRow?.outboundVolumeCbm) || 0) * 10) / 10,
        weightKg: outboundWeightKg,
        weightTons: Math.round((outboundWeightKg / 1000) * 100) / 100,
        tripCount: Number(dbRow?.outboundTripCount) || 0,
        orderCount: Number(dbRow?.outboundOrderCount) || 0,
        packageCount: Number(dbRow?.outboundPackageCount) || 0,
      };

      const chosen = this.pickDirectionMetrics(inbound, outbound, direction);
      const [yStr, mStr, dStr] = d.split('-');
      const dayOfMonth = Number(dStr);

      return {
        reportDate: d,
        dayOfMonth,
        dayLabel: sameMonthInRange ? String(dayOfMonth) : `${dStr}/${mStr}`,
        fullDateLabel: `${dStr}/${mStr}/${yStr}`,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        windowLabel,
        isClosed: windowEnd.getTime() <= now.getTime(),
        isFuture: windowStart.getTime() > now.getTime(),
        triggeredBy: dbRow?.triggeredBy || 'CRON',
        ...chosen,
        inbound,
        outbound,
      };
    });

    // Calculate Summary & Averages for Slide 2
    const totalInbound: DirectionMetrics = {
      cbm:
        Math.round(dailySeries.reduce((s, x) => s + x.inbound.cbm, 0) * 10) /
        10,
      weightKg:
        Math.round(
          dailySeries.reduce((s, x) => s + x.inbound.weightKg, 0) * 100,
        ) / 100,
      weightTons:
        Math.round(
          (dailySeries.reduce((s, x) => s + x.inbound.weightKg, 0) / 1000) *
            100,
        ) / 100,
      tripCount: dailySeries.reduce((s, x) => s + x.inbound.tripCount, 0),
      orderCount: dailySeries.reduce((s, x) => s + x.inbound.orderCount, 0),
      packageCount: dailySeries.reduce((s, x) => s + x.inbound.packageCount, 0),
    };

    const totalOutbound: DirectionMetrics = {
      cbm:
        Math.round(dailySeries.reduce((s, x) => s + x.outbound.cbm, 0) * 10) /
        10,
      weightKg:
        Math.round(
          dailySeries.reduce((s, x) => s + x.outbound.weightKg, 0) * 100,
        ) / 100,
      weightTons:
        Math.round(
          (dailySeries.reduce((s, x) => s + x.outbound.weightKg, 0) / 1000) *
            100,
        ) / 100,
      tripCount: dailySeries.reduce((s, x) => s + x.outbound.tripCount, 0),
      orderCount: dailySeries.reduce((s, x) => s + x.outbound.orderCount, 0),
      packageCount: dailySeries.reduce(
        (s, x) => s + x.outbound.packageCount,
        0,
      ),
    };

    const chosenTotal = this.pickDirectionMetrics(
      totalInbound,
      totalOutbound,
      direction,
    );

    const nonFutureDaysCount = dailySeries.filter((d) => !d.isFuture).length;
    const effectiveDaysCount = Math.max(
      1,
      nonFutureDaysCount > 0 ? nonFutureDaysCount : dailySeries.length,
    );
    const activeDaysCount = dailySeries.filter(
      (d) => d.cbm > 0 || d.weightKg > 0 || d.tripCount > 0,
    ).length;

    const averageCbmPerDay =
      Math.round((chosenTotal.cbm / effectiveDaysCount) * 10) / 10;
    const averageTonsPerDay =
      Math.round((chosenTotal.weightTons / effectiveDaysCount) * 100) / 100;

    // 3. Build Slide 3: Monthly Trend Series (SỐ KHỐI & SỐ TẤN)
    const monthKeysList: string[] = [];
    const startYearMonth = overallQueryStart.slice(0, 7);
    const endYearMonth = toDate.slice(0, 7);
    let [currY, currM] = startYearMonth.split('-').map(Number);
    const [endY, endM] = endYearMonth.split('-').map(Number);
    let mSafety = 0;
    while (
      (currY < endY || (currY === endY && currM <= endM)) &&
      mSafety < 24
    ) {
      monthKeysList.push(`${currY}-${String(currM).padStart(2, '0')}`);
      currM++;
      if (currM > 12) {
        currM = 1;
        currY++;
      }
      mSafety++;
    }

    const spansMultipleYears =
      monthKeysList.length > 0 &&
      monthKeysList[0].slice(0, 4) !==
        monthKeysList[monthKeysList.length - 1].slice(0, 4);

    // Query monthly aggregates from daily_hub_operational_report across monthKeysList
    const monthEndFullDate = new Date(Date.UTC(endY, endM, 0))
      .toISOString()
      .slice(0, 10);
    const monthlyDbParams: any[] = [overallQueryStart, monthEndFullDate];
    let monthlyHubFilterSql = '';
    if (hubId) {
      monthlyDbParams.push(hubId);
      monthlyHubFilterSql = `AND r."hubId" = $${monthlyDbParams.length}`;
    }

    const monthlyDbRows: Array<{
      monthKey: string;
      inboundVolumeCbm: number;
      inboundWeightKg: number;
      inboundPackageCount: number;
      inboundTripCount: number;
      inboundOrderCount: number;
      outboundVolumeCbm: number;
      outboundWeightKg: number;
      outboundPackageCount: number;
      outboundTripCount: number;
      outboundOrderCount: number;
    }> = await this.dataSource.query(
      `
      SELECT
        SUBSTRING(r."reportDate", 1, 7) AS "monthKey",
        COALESCE(SUM(r."inboundVolumeCbm"), 0)::float AS "inboundVolumeCbm",
        COALESCE(SUM(r."inboundWeightKg"), 0)::float AS "inboundWeightKg",
        COALESCE(SUM(r."inboundPackageCount"), 0)::int AS "inboundPackageCount",
        COALESCE(SUM(r."inboundTripCount"), 0)::int AS "inboundTripCount",
        COALESCE(SUM(r."inboundOrderCount"), 0)::int AS "inboundOrderCount",
        COALESCE(SUM(r."outboundVolumeCbm"), 0)::float AS "outboundVolumeCbm",
        COALESCE(SUM(r."outboundWeightKg"), 0)::float AS "outboundWeightKg",
        COALESCE(SUM(r."outboundPackageCount"), 0)::int AS "outboundPackageCount",
        COALESCE(SUM(r."outboundTripCount"), 0)::int AS "outboundTripCount",
        COALESCE(SUM(r."outboundOrderCount"), 0)::int AS "outboundOrderCount"
      FROM "daily_hub_operational_report" r
      WHERE r."deletedAt" IS NULL
        AND r."reportDate" >= $1
        AND r."reportDate" <= $2
        ${monthlyHubFilterSql}
      GROUP BY SUBSTRING(r."reportDate", 1, 7)
      ORDER BY "monthKey" ASC
      `,
      monthlyDbParams,
    );

    const monthlyMap = new Map<string, (typeof monthlyDbRows)[number]>();
    for (const mr of monthlyDbRows) {
      monthlyMap.set(mr.monthKey, mr);
    }

    const monthlySeries: MonthlyReportPoint[] = monthKeysList.map((mk) => {
      const mr = monthlyMap.get(mk);
      const [y, m] = mk.split('-').map(Number);

      const inboundWeightKg =
        Math.round((Number(mr?.inboundWeightKg) || 0) * 100) / 100;
      const inbound: DirectionMetrics = {
        cbm: Math.round((Number(mr?.inboundVolumeCbm) || 0) * 10) / 10,
        weightKg: inboundWeightKg,
        weightTons: Math.round((inboundWeightKg / 1000) * 100) / 100,
        tripCount: Number(mr?.inboundTripCount) || 0,
        orderCount: Number(mr?.inboundOrderCount) || 0,
        packageCount: Number(mr?.inboundPackageCount) || 0,
      };

      const outboundWeightKg =
        Math.round((Number(mr?.outboundWeightKg) || 0) * 100) / 100;
      const outbound: DirectionMetrics = {
        cbm: Math.round((Number(mr?.outboundVolumeCbm) || 0) * 10) / 10,
        weightKg: outboundWeightKg,
        weightTons: Math.round((outboundWeightKg / 1000) * 100) / 100,
        tripCount: Number(mr?.outboundTripCount) || 0,
        orderCount: Number(mr?.outboundOrderCount) || 0,
        packageCount: Number(mr?.outboundPackageCount) || 0,
      };

      const chosen = this.pickDirectionMetrics(inbound, outbound, direction);
      return {
        monthKey: mk,
        year: y,
        month: m,
        monthLabel: spansMultipleYears ? `THÁNG ${m}/${y}` : `THÁNG ${m}`,
        ...chosen,
        inbound,
        outbound,
      };
    });

    // 4. Per-Hub Breakdown in [fromDate, toDate]
    const hubBreakdownRows: Array<{
      hubId: number;
      inboundVolumeCbm: number;
      inboundWeightKg: number;
      inboundPackageCount: number;
      inboundTripCount: number;
      inboundOrderCount: number;
      outboundVolumeCbm: number;
      outboundWeightKg: number;
      outboundPackageCount: number;
      outboundTripCount: number;
      outboundOrderCount: number;
    }> = await this.dataSource.query(
      `
      SELECT
        r."hubId" AS "hubId",
        COALESCE(SUM(r."inboundVolumeCbm"), 0)::float AS "inboundVolumeCbm",
        COALESCE(SUM(r."inboundWeightKg"), 0)::float AS "inboundWeightKg",
        COALESCE(SUM(r."inboundPackageCount"), 0)::int AS "inboundPackageCount",
        COALESCE(SUM(r."inboundTripCount"), 0)::int AS "inboundTripCount",
        COALESCE(SUM(r."inboundOrderCount"), 0)::int AS "inboundOrderCount",
        COALESCE(SUM(r."outboundVolumeCbm"), 0)::float AS "outboundVolumeCbm",
        COALESCE(SUM(r."outboundWeightKg"), 0)::float AS "outboundWeightKg",
        COALESCE(SUM(r."outboundPackageCount"), 0)::int AS "outboundPackageCount",
        COALESCE(SUM(r."outboundTripCount"), 0)::int AS "outboundTripCount",
        COALESCE(SUM(r."outboundOrderCount"), 0)::int AS "outboundOrderCount"
      FROM "daily_hub_operational_report" r
      WHERE r."deletedAt" IS NULL
        AND r."reportDate" >= $1
        AND r."reportDate" <= $2
      GROUP BY r."hubId"
      `,
      [fromDate, toDate],
    );

    const hubBreakdownMap = new Map<
      number,
      (typeof hubBreakdownRows)[number]
    >();
    for (const hr of hubBreakdownRows) {
      hubBreakdownMap.set(Number(hr.hubId), hr);
    }

    const hubBreakdown = allHubs.map((h) => {
      const hr = hubBreakdownMap.get(h.id);
      const inWtKg = Math.round((Number(hr?.inboundWeightKg) || 0) * 100) / 100;
      const inbound: DirectionMetrics = {
        cbm: Math.round((Number(hr?.inboundVolumeCbm) || 0) * 10) / 10,
        weightKg: inWtKg,
        weightTons: Math.round((inWtKg / 1000) * 100) / 100,
        tripCount: Number(hr?.inboundTripCount) || 0,
        orderCount: Number(hr?.inboundOrderCount) || 0,
        packageCount: Number(hr?.inboundPackageCount) || 0,
      };
      const outWtKg =
        Math.round((Number(hr?.outboundWeightKg) || 0) * 100) / 100;
      const outbound: DirectionMetrics = {
        cbm: Math.round((Number(hr?.outboundVolumeCbm) || 0) * 10) / 10,
        weightKg: outWtKg,
        weightTons: Math.round((outWtKg / 1000) * 100) / 100,
        tripCount: Number(hr?.outboundTripCount) || 0,
        orderCount: Number(hr?.outboundOrderCount) || 0,
        packageCount: Number(hr?.outboundPackageCount) || 0,
      };
      const chosen = this.pickDirectionMetrics(inbound, outbound, direction);
      return {
        hubId: h.id,
        code: h.code,
        name: h.name,
        city: h.city,
        level: h.level || 1,
        ...chosen,
        inbound,
        outbound,
      };
    });

    // 5. Confirmed Trip Drill-Down List in [fromDate 18:00 D-1, toDate 18:00 D)
    const rangeStartWindow = this.getReportWindow(fromDate).windowStart;
    const rangeEndWindow = this.getReportWindow(toDate).windowEnd;
    const tripQueryParams: any[] = [
      rangeStartWindow.toISOString(),
      rangeEndWindow.toISOString(),
    ];
    let tripHubSql = '';
    if (hubId) {
      tripQueryParams.push(hubId);
      tripHubSql = `AND COALESCE(tx."hubId", o."originHubId", o."currentHubId") = $${tripQueryParams.length}`;
    }
    let tripTypeSql = `AND tx."type" IN ('INBOUND', 'OUTBOUND', 'TRANSFER')`;
    if (direction === 'INBOUND') {
      tripTypeSql = `AND tx."type" = 'INBOUND'`;
    } else if (direction === 'OUTBOUND') {
      tripTypeSql = `AND tx."type" IN ('OUTBOUND', 'TRANSFER')`;
    }

    const rawConfirmedTrips: Array<{
      tripCode: string;
      invoiceCode: string | null;
      reportDate: string;
      confirmedAt: Date;
      direction: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
      hubId: number;
      hubCode: string | null;
      hubName: string | null;
      hubLevel: number | null;
      licensePlate: string | null;
      driverName: string | null;
      orderCount: number;
      packageCount: number;
      weightKg: number;
      volumeCbm: number;
    }> = await this.dataSource.query(
      `
      SELECT
        COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), 'TX-' || tx.id::text) AS "tripCode",
        MAX(tx."invoiceCode") AS "invoiceCode",
        TO_CHAR(MAX(tx."createdAt") + INTERVAL '1 hour', 'YYYY-MM-DD') AS "reportDate",
        MAX(tx."createdAt") AS "confirmedAt",
        CASE
          WHEN BOOL_OR(tx."type" = 'INBOUND') THEN 'INBOUND'
          WHEN BOOL_OR(tx."type" = 'TRANSFER') THEN 'TRANSFER'
          ELSE 'OUTBOUND'
        END AS "direction",
        COALESCE(tx."hubId", o."originHubId", o."currentHubId")::int AS "hubId",
        h."code" AS "hubCode",
        COALESCE(h."name", 'Kho vận hành') AS "hubName",
        COALESCE(h."level", 1)::int AS "hubLevel",
        MAX(tx."licensePlate") AS "licensePlate",
        MAX(tx."driverName") AS "driverName",
        COUNT(DISTINCT tx."orderId")::int AS "orderCount",
        COALESCE(SUM(tx."quantity"), 0)::int AS "packageCount",
        COALESCE(SUM(
          CASE
            WHEN COALESCE(tx."weight", 0) > 0 THEN tx."weight"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalWeight", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END
        ), 0)::float AS "weightKg",
        COALESCE(SUM(
          CASE
            WHEN COALESCE(tx."volume", 0) > 0 THEN tx."volume"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalVolume", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END
        ), 0)::float AS "volumeCbm"
      FROM "order_inventory_transaction" tx
      INNER JOIN "order" o ON o.id = tx."orderId" AND o."deletedAt" IS NULL
      LEFT JOIN "hub" h ON h.id = COALESCE(tx."hubId", o."originHubId", o."currentHubId")
      WHERE tx."deletedAt" IS NULL
        AND tx."createdAt" >= $1
        AND tx."createdAt" < $2
        AND EXISTS (
          SELECT 1
          FROM "daily_hub_operational_report" r_snap
          WHERE r_snap."deletedAt" IS NULL
            AND r_snap."reportDate" = TO_CHAR(tx."createdAt" + INTERVAL '1 hour', 'YYYY-MM-DD')
        )
        ${tripTypeSql}
        ${tripHubSql}
      GROUP BY
        COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), 'TX-' || tx.id::text),
        COALESCE(tx."hubId", o."originHubId", o."currentHubId"),
        h."code",
        h."name",
        h."level",
        CASE WHEN tx."type" = 'INBOUND' THEN 'IN' ELSE 'OUT' END
      ORDER BY MAX(tx."createdAt") DESC
      LIMIT 250
      `,
      tripQueryParams,
    );

    const confirmedTrips: ConfirmedTripReportItem[] = rawConfirmedTrips.map(
      (t) => {
        const { windowLabel } = this.getReportWindow(t.reportDate);
        const weightKg = Math.round((Number(t.weightKg) || 0) * 100) / 100;
        return {
          tripCode: t.tripCode,
          invoiceCode: t.invoiceCode || null,
          reportDate: t.reportDate,
          windowLabel,
          confirmedAt:
            t.confirmedAt instanceof Date
              ? t.confirmedAt.toISOString()
              : new Date(t.confirmedAt).toISOString(),
          direction: t.direction,
          hubId: Number(t.hubId) || 0,
          hubCode: t.hubCode || null,
          hubName: t.hubName || 'Kho vận hành',
          hubLevel: Number(t.hubLevel) || 1,
          licensePlate: t.licensePlate || null,
          driverName: t.driverName || null,
          orderCount: Number(t.orderCount) || 0,
          packageCount: Number(t.packageCount) || 0,
          weightKg,
          weightTons: Math.round((weightKg / 1000) * 100) / 100,
          volumeCbm: Math.round((Number(t.volumeCbm) || 0) * 10) / 10,
        };
      },
    );

    return {
      filter: {
        fromDate,
        toDate,
        hubId: hubId ?? 'ALL',
        hubName: selectedHub
          ? selectedHub.name
          : 'Tất cả Chi nhánh (Toàn hệ thống)',
        hubCode: selectedHub?.code ?? 'ALL',
        hubLevel: selectedHub?.level ?? null,
        direction,
        cutoffRule:
          'Từ 06:00 (6:00 AM) ngày D-1 đến 05:59 (5:59 AM) ngày D (GMT+7)',
        cronSchedule: '06:05 hàng ngày (GMT+7)',
        lastClosedReportDate: latestClosedReportDate,
        lastCronRunAt: this.lastCronRunAt
          ? this.lastCronRunAt.toISOString()
          : null,
      },
      summary: {
        ...chosenTotal,
        averageCbmPerDay,
        averageTonsPerDay,
        totalDaysInRange: dailySeries.length,
        effectiveDaysCount,
        activeDaysCount,
        inbound: {
          ...totalInbound,
          averageCbmPerDay:
            Math.round((totalInbound.cbm / effectiveDaysCount) * 10) / 10,
          averageTonsPerDay:
            Math.round((totalInbound.weightTons / effectiveDaysCount) * 100) /
            100,
        },
        outbound: {
          ...totalOutbound,
          averageCbmPerDay:
            Math.round((totalOutbound.cbm / effectiveDaysCount) * 10) / 10,
          averageTonsPerDay:
            Math.round((totalOutbound.weightTons / effectiveDaysCount) * 100) /
            100,
        },
      },
      dailySeries,
      monthlySeries,
      hubBreakdown,
      confirmedTrips,
    };
  }

  /**
   * Execute a report aggregation for a specific day (or date range) and record an immutable
   * execution log row in `cron_job_execution_log`, while updating `cron_job_config` metadata.
   */
  public async executeAndLogCronRun(params: {
    jobKey?: string;
    fromDate: string;
    toDate?: string;
    triggeredBy:
      | 'CRON_SCHEDULED'
      | 'MANUAL_RERUN'
      | 'MANUAL_RANGE'
      | 'STARTUP_INIT';
    notifySuperAdmins?: boolean;
    actorUser?: { id?: number; email?: string };
  }) {
    await this.ensureTableExists();
    const config = await this.getOrCreateDefaultCronConfig(
      params.jobKey || 'DAILY_HUB_OPERATIONAL_REPORT',
    );

    const latestClosed = this.getLatestClosedReportDate();
    let fromDate = this.sanitizeDateParam(params.fromDate, latestClosed);
    let toDate = this.sanitizeDateParam(
      params.toDate || params.fromDate,
      fromDate,
    );
    if (fromDate > toDate) {
      const tmp = fromDate;
      fromDate = toDate;
      toDate = tmp;
    }

    const startWin = this.getReportWindow(fromDate);
    const formatVnDate = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    const windowLabel =
      fromDate === toDate
        ? startWin.windowLabel
        : `06:00 ${formatVnDate(startWin.prevDateStr)} → 05:59 ${formatVnDate(toDate)}`;

    let actorEmail = params.actorUser?.email || null;
    const actorUserId = params.actorUser?.id
      ? Number(params.actorUser.id)
      : null;
    if (!actorEmail && actorUserId) {
      if (this.actorEmailCache.has(actorUserId)) {
        actorEmail = this.actorEmailCache.get(actorUserId) || null;
      } else {
        const foundUser = await this.userRepository.findOne({
          where: { id: actorUserId },
        });
        actorEmail = foundUser?.email || null;
        if (actorEmail) {
          this.actorEmailCache.set(actorUserId, actorEmail);
        }
      }
    }

    const startedAt = new Date();
    const snapshotTriggerMode =
      params.triggeredBy === 'CRON_SCHEDULED' ? 'CRON' : 'MANUAL';

    try {
      const aggResult = await this.aggregateAndSaveDateRange(
        fromDate,
        toDate,
        snapshotTriggerMode,
        Boolean(params.notifySuperAdmins),
      );

      // Split into per-day summaries so multi-day runs create an individual execution log per day
      const perDayRows: Array<{
        reportDate: string;
        hubCount: number;
        totalInboundCbm: number;
        totalInboundWeightKg: number;
        totalInboundTrips: number;
        totalOutboundCbm: number;
        totalOutboundWeightKg: number;
        totalOutboundTrips: number;
      }> = await this.dataSource.query(
        `
        SELECT
          r."reportDate" AS "reportDate",
          COUNT(r.id)::int AS "hubCount",
          COALESCE(SUM(r."inboundVolumeCbm"), 0)::float AS "totalInboundCbm",
          COALESCE(SUM(r."inboundWeightKg"), 0)::float AS "totalInboundWeightKg",
          COALESCE(SUM(r."inboundTripCount"), 0)::int AS "totalInboundTrips",
          COALESCE(SUM(r."outboundVolumeCbm"), 0)::float AS "totalOutboundCbm",
          COALESCE(SUM(r."outboundWeightKg"), 0)::float AS "totalOutboundWeightKg",
          COALESCE(SUM(r."outboundTripCount"), 0)::int AS "totalOutboundTrips"
        FROM "daily_hub_operational_report" r
        WHERE r."deletedAt" IS NULL
          AND r."reportDate" >= $1
          AND r."reportDate" <= $2
        GROUP BY r."reportDate"
        ORDER BY r."reportDate" ASC
        `,
        [fromDate, toDate],
      );

      const perDayMap = new Map<string, (typeof perDayRows)[number]>();
      for (const r of perDayRows) {
        perDayMap.set(r.reportDate, r);
      }

      const totalInboundCbm =
        Math.round(
          perDayRows.reduce((s, r) => s + (Number(r.totalInboundCbm) || 0), 0) *
            10,
        ) / 10;
      const totalInboundTons =
        Math.round(
          (perDayRows.reduce(
            (s, r) => s + (Number(r.totalInboundWeightKg) || 0),
            0,
          ) /
            1000) *
            100,
        ) / 100;
      const totalInboundTrips = perDayRows.reduce(
        (s, r) => s + (Number(r.totalInboundTrips) || 0),
        0,
      );
      const totalOutboundCbm =
        Math.round(
          perDayRows.reduce(
            (s, r) => s + (Number(r.totalOutboundCbm) || 0),
            0,
          ) * 10,
        ) / 10;
      const totalOutboundTons =
        Math.round(
          (perDayRows.reduce(
            (s, r) => s + (Number(r.totalOutboundWeightKg) || 0),
            0,
          ) /
            1000) *
            100,
        ) / 100;
      const totalOutboundTrips = perDayRows.reduce(
        (s, r) => s + (Number(r.totalOutboundTrips) || 0),
        0,
      );

      const finishedAt = new Date();
      const durationMs = Math.max(
        1,
        finishedAt.getTime() - startedAt.getTime(),
      );

      const individualDays = this.enumerateDates(fromDate, toDate);
      const perDayDuration = Math.max(
        1,
        Math.round(durationMs / Math.max(1, individualDays.length)),
      );
      const resolvedActorEmail =
        actorEmail ||
        (params.triggeredBy === 'CRON_SCHEDULED'
          ? 'SYSTEM_CRON'
          : params.triggeredBy === 'STARTUP_INIT'
            ? 'SYSTEM_INIT'
            : 'SUPER_ADMIN');

      const logEntitiesToSave = individualDays.map((dayStr) => {
        const dRow = perDayMap.get(dayStr);
        const dayWin = this.getReportWindow(dayStr);
        const dInCbm =
          Math.round((Number(dRow?.totalInboundCbm) || 0) * 10) / 10;
        const dInTons =
          Math.round(((Number(dRow?.totalInboundWeightKg) || 0) / 1000) * 100) /
          100;
        const dInTrips = Number(dRow?.totalInboundTrips) || 0;
        const dOutCbm =
          Math.round((Number(dRow?.totalOutboundCbm) || 0) * 10) / 10;
        const dOutTons =
          Math.round(
            ((Number(dRow?.totalOutboundWeightKg) || 0) / 1000) * 100,
          ) / 100;
        const dOutTrips = Number(dRow?.totalOutboundTrips) || 0;

        return this.cronLogRepository.create({
          jobKey: config.jobKey,
          targetDate: dayStr,
          targetEndDate: dayStr,
          windowLabel: dayWin.windowLabel,
          triggeredBy: params.triggeredBy,
          actorUserId,
          actorEmail: resolvedActorEmail,
          status: 'SUCCESS',
          processedDays: 1,
          upsertedHubRows: Number(dRow?.hubCount) || 0,
          totalInboundCbm: dInCbm,
          totalInboundTons: dInTons,
          totalInboundTrips: dInTrips,
          totalOutboundCbm: dOutCbm,
          totalOutboundTons: dOutTons,
          totalOutboundTrips: dOutTrips,
          durationMs: perDayDuration,
          errorMessage: null,
          startedAt,
          finishedAt,
        });
      });

      const savedLogs = await this.cronLogRepository.save(logEntitiesToSave);
      const logEntity = savedLogs[savedLogs.length - 1];

      config.lastRunAt = finishedAt;
      config.lastRunStatus = 'SUCCESS';
      config.lastReportDate = toDate;
      await this.cronConfigRepository.save(config);

      this.lastCronRunAt = finishedAt;

      return {
        log: logEntity,
        processedDays: aggResult.processedDays,
        upsertedRows: aggResult.upsertedRows,
        fromDate,
        toDate,
        windowLabel,
        summary: {
          totalInboundCbm,
          totalInboundTons,
          totalInboundTrips,
          totalOutboundCbm,
          totalOutboundTons,
          totalOutboundTrips,
        },
      };
    } catch (err) {
      const finishedAt = new Date();
      const durationMs = Math.max(
        1,
        finishedAt.getTime() - startedAt.getTime(),
      );
      const errMsg = (err as Error)?.message || 'Unknown error';

      await this.cronLogRepository.save(
        this.cronLogRepository.create({
          jobKey: config.jobKey,
          targetDate: fromDate,
          targetEndDate: toDate,
          windowLabel,
          triggeredBy: params.triggeredBy,
          actorUserId,
          actorEmail: actorEmail || 'SYSTEM',
          status: 'FAILED',
          processedDays: 0,
          upsertedHubRows: 0,
          durationMs,
          errorMessage: errMsg,
          startedAt,
          finishedAt,
        }),
      );

      config.lastRunAt = finishedAt;
      config.lastRunStatus = 'FAILED';
      await this.cronConfigRepository.save(config);

      throw err;
    }
  }

  /**
   * Update Cronjob configuration (`isEnabled`, `cronTime`, `cutoffHour`, `notifySuperAdmins`).
   */
  public async updateCronJobConfig(
    dto: {
      jobKey?: string;
      isEnabled?: boolean;
      cronTime?: string;
      cutoffHour?: number;
      notifySuperAdmins?: boolean;
      description?: string;
    },
    actorUser?: { id?: number; email?: string },
  ) {
    const config = await this.getOrCreateDefaultCronConfig(
      dto.jobKey || 'DAILY_HUB_OPERATIONAL_REPORT',
    );

    if (typeof dto.isEnabled === 'boolean') {
      config.isEnabled = dto.isEnabled;
    }
    if (
      typeof dto.cronTime === 'string' &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(dto.cronTime.trim())
    ) {
      config.cronTime = dto.cronTime.trim();
    }
    if (
      typeof dto.cutoffHour === 'number' &&
      Number.isInteger(dto.cutoffHour) &&
      dto.cutoffHour >= 0 &&
      dto.cutoffHour <= 23
    ) {
      config.cutoffHour = dto.cutoffHour;
    }
    if (typeof dto.notifySuperAdmins === 'boolean') {
      config.notifySuperAdmins = dto.notifySuperAdmins;
    }
    if (typeof dto.description === 'string' && dto.description.trim()) {
      config.description = dto.description.trim();
    }
    if (actorUser?.id) {
      config.updatedByUserId = Number(actorUser.id);
    }

    return this.cronConfigRepository.save(config);
  }

  /**
   * Retrieve complete Cronjob Management Dashboard data for `/dashboard/admin/cronjobs`:
   * - `config`: Current `cron_job_config` settings
   * - `scheduleInfo`: Current VN time, latest closed reportDate, current open reportDate, next scheduled run
   * - `logs`: Recent execution logs from `cron_job_execution_log`
   * - `dailySnapshots`: Daily snapshot status table for the last 30 days (with 1-click Re-run support)
   */
  public async getCronJobManagementData(query?: { daysLimit?: number }) {
    await this.ensureTableExists();
    const config = await this.getOrCreateDefaultCronConfig();

    const now = new Date();
    const vnNow = this.getVietnamDateParts(now);
    const latestClosedReportDate = this.getLatestClosedReportDate(now);
    const currentOpenReportDate = this.addDays(latestClosedReportDate, 1);

    const daysLimit = Math.max(
      7,
      Math.min(366, Number(query?.daysLimit) || 30),
    );
    const snapshotStartDate = this.addDays(
      currentOpenReportDate,
      -(daysLimit - 1),
    );
    const expectedDays = this.enumerateDates(
      snapshotStartDate,
      currentOpenReportDate,
    );

    const logs = await this.cronLogRepository.find({
      order: { startedAt: 'DESC', id: 'DESC' },
      take: 200,
    });

    const rawSnapshots: Array<{
      reportDate: string;
      hubCount: number;
      inboundVolumeCbm: number;
      inboundWeightKg: number;
      inboundPackageCount: number;
      inboundTripCount: number;
      inboundOrderCount: number;
      outboundVolumeCbm: number;
      outboundWeightKg: number;
      outboundPackageCount: number;
      outboundTripCount: number;
      outboundOrderCount: number;
      triggeredBy: string;
      calculatedAt: Date;
    }> = await this.dataSource.query(
      `
      SELECT
        r."reportDate" AS "reportDate",
        COUNT(DISTINCT r."hubId")::int AS "hubCount",
        COALESCE(SUM(r."inboundVolumeCbm"), 0)::float AS "inboundVolumeCbm",
        COALESCE(SUM(r."inboundWeightKg"), 0)::float AS "inboundWeightKg",
        COALESCE(SUM(r."inboundPackageCount"), 0)::int AS "inboundPackageCount",
        COALESCE(SUM(r."inboundTripCount"), 0)::int AS "inboundTripCount",
        COALESCE(SUM(r."inboundOrderCount"), 0)::int AS "inboundOrderCount",
        COALESCE(SUM(r."outboundVolumeCbm"), 0)::float AS "outboundVolumeCbm",
        COALESCE(SUM(r."outboundWeightKg"), 0)::float AS "outboundWeightKg",
        COALESCE(SUM(r."outboundPackageCount"), 0)::int AS "outboundPackageCount",
        COALESCE(SUM(r."outboundTripCount"), 0)::int AS "outboundTripCount",
        COALESCE(SUM(r."outboundOrderCount"), 0)::int AS "outboundOrderCount",
        MAX(r."triggeredBy") AS "triggeredBy",
        MAX(r."calculatedAt") AS "calculatedAt"
      FROM "daily_hub_operational_report" r
      WHERE r."deletedAt" IS NULL
        AND r."reportDate" >= $1
        AND r."reportDate" <= $2
      GROUP BY r."reportDate"
      ORDER BY r."reportDate" DESC
      `,
      [snapshotStartDate, currentOpenReportDate],
    );

    const snapMap = new Map<string, (typeof rawSnapshots)[number]>();
    for (const s of rawSnapshots) {
      snapMap.set(s.reportDate, s);
    }

    const dailySnapshots = [...expectedDays].reverse().map((d) => {
      const s = snapMap.get(d);
      const { windowStart, windowEnd, windowLabel } = this.getReportWindow(d);
      const [yStr, mStr, dStr] = d.split('-');
      const inboundWeightKg =
        Math.round((Number(s?.inboundWeightKg) || 0) * 100) / 100;
      const outboundWeightKg =
        Math.round((Number(s?.outboundWeightKg) || 0) * 100) / 100;

      return {
        reportDate: d,
        fullDateLabel: `${dStr}/${mStr}/${yStr}`,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        windowLabel,
        isClosed: windowEnd.getTime() <= now.getTime(),
        isCurrentOpen: d === currentOpenReportDate,
        hubCount: Number(s?.hubCount) || 0,
        triggeredBy: s?.triggeredBy || 'CRON',
        calculatedAt: s?.calculatedAt
          ? new Date(s.calculatedAt).toISOString()
          : null,
        inboundCbm: Math.round((Number(s?.inboundVolumeCbm) || 0) * 10) / 10,
        inboundWeightKg,
        inboundTons: Math.round((inboundWeightKg / 1000) * 100) / 100,
        inboundTrips: Number(s?.inboundTripCount) || 0,
        inboundOrders: Number(s?.inboundOrderCount) || 0,
        inboundPackages: Number(s?.inboundPackageCount) || 0,
        outboundCbm: Math.round((Number(s?.outboundVolumeCbm) || 0) * 10) / 10,
        outboundWeightKg,
        outboundTons: Math.round((outboundWeightKg / 1000) * 100) / 100,
        outboundTrips: Number(s?.outboundTripCount) || 0,
        outboundOrders: Number(s?.outboundOrderCount) || 0,
        outboundPackages: Number(s?.outboundPackageCount) || 0,
      };
    });

    // Calculate next scheduled run in GMT+7
    const computeNextRunInfo = (job: CronJobConfigEntity) => {
      const [jH, jM] = (job.cronTime || '18:05').split(':').map(Number);
      const todayCandidate = new Date(
        `${vnNow.dateStr}T${String(jH || 18).padStart(2, '0')}:${String(jM || 0).padStart(2, '0')}:00+07:00`,
      );
      const nextDateStr =
        todayCandidate.getTime() > now.getTime()
          ? vnNow.dateStr
          : this.addDays(vnNow.dateStr, 1);
      const nextAt = new Date(
        `${nextDateStr}T${String(jH || 18).padStart(2, '0')}:${String(jM || 0).padStart(2, '0')}:00+07:00`,
      );
      const [jny, jnm, jnd] = nextDateStr.split('-');
      return {
        nextRunAt: job.isEnabled ? nextAt.toISOString() : null,
        nextRunLabel: job.isEnabled
          ? `${job.cronTime} ngày ${jnd}/${jnm}/${jny} (GMT+7)`
          : 'Đang tạm dừng (Tắt tự động)',
      };
    };

    const allJobs = await this.cronConfigRepository.find({
      order: { id: 'ASC' },
    });
    const jobs = allJobs.map((j) => {
      const nextInfo = computeNextRunInfo(j);
      return {
        id: j.id,
        jobKey: j.jobKey,
        name: j.name,
        description: j.description,
        isEnabled: j.isEnabled,
        cronTime: j.cronTime,
        cutoffHour: j.cutoffHour,
        notifySuperAdmins: j.notifySuperAdmins,
        lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
        lastRunStatus: j.lastRunStatus,
        lastReportDate: j.lastReportDate,
        nextRunAt: nextInfo.nextRunAt,
        nextRunLabel: nextInfo.nextRunLabel,
      };
    });

    const primaryNextInfo = computeNextRunInfo(config);

    return {
      config,
      jobs,
      scheduleInfo: {
        currentVnTime: `${String(vnNow.hour).padStart(2, '0')}:${String(vnNow.minute).padStart(2, '0')} (${vnNow.dateStr.split('-').reverse().join('/')})`,
        latestClosedReportDate,
        latestClosedWindowLabel: this.getReportWindow(latestClosedReportDate)
          .windowLabel,
        currentOpenReportDate,
        currentOpenWindowLabel: this.getReportWindow(currentOpenReportDate)
          .windowLabel,
        nextRunAt: primaryNextInfo.nextRunAt,
        nextRunLabel: primaryNextInfo.nextRunLabel,
        cutoffRule:
          'Từ 06:00 (6:00 AM) ngày D-1 đến 05:59 (5:59 AM) ngày D (GMT+7)',
      },
      logs,
      dailySnapshots,
    };
  }

  /**
   * Dedicated Single-Day TRIP Tracking & Inspection Report for `/dashboard/admin/reports/trips`:
   * Returns exact counts of Inbound vs Outbound confirmed vehicles (TRIPs) for a specific operational
   * `reportDate` (`[D-1 18:00 GMT+7, D 18:00 GMT+7)`), along with every TRIP's full order manifest
   * and a 14-day quick-navigation strip.
   */
  public async getDailyTripsDetailReport(query?: {
    reportDate?: string;
    hubId?: string | number;
    direction?: string;
  }) {
    await this.ensureTableExists();
    const now = new Date();
    const latestClosedReportDate = this.getLatestClosedReportDate(now);
    const currentOpenReportDate = this.addDays(latestClosedReportDate, 1);

    let defaultDate = latestClosedReportDate;
    if (!query?.reportDate) {
      // Find the most recent operational date that has confirmed transactions so initial load is rich
      const latestActiveRow: Array<{ reportDate: string }> =
        await this.dataSource.query(
          `
          SELECT TO_CHAR(MAX(tx."createdAt") + INTERVAL '1 hour', 'YYYY-MM-DD') AS "reportDate"
          FROM "order_inventory_transaction" tx
          INNER JOIN "order" o ON o.id = tx."orderId" AND o."deletedAt" IS NULL
          WHERE tx."deletedAt" IS NULL
            AND tx."type" IN ('INBOUND', 'OUTBOUND', 'TRANSFER')
          `,
        );
      if (
        latestActiveRow?.[0]?.reportDate &&
        /^\d{4}-\d{2}-\d{2}$/.test(latestActiveRow[0].reportDate)
      ) {
        defaultDate = latestActiveRow[0].reportDate;
      }
    }

    const reportDate = this.sanitizeDateParam(query?.reportDate, defaultDate);
    const hubId =
      query?.hubId && String(query.hubId).toUpperCase() !== 'ALL'
        ? Number(query.hubId) || null
        : null;
    const rawDir = String(query?.direction || 'ALL').toUpperCase();
    const direction: ReportDirection =
      rawDir === 'INBOUND' || rawDir === 'OUTBOUND' ? rawDir : 'ALL';

    const { windowStart, windowEnd, windowLabel } =
      this.getReportWindow(reportDate);
    const [yStr, mStr, dStr] = reportDate.split('-');
    const fullDateLabel = `${dStr}/${mStr}/${yStr}`;

    const allHubs = await this.hubRepository.find({
      where: { isActive: true },
      order: { level: 'ASC', id: 'ASC' },
    });
    const selectedHub = hubId
      ? allHubs.find((h) => h.id === hubId) || null
      : null;

    // 1. Query all confirmed inventory transactions inside [windowStart, windowEnd)
    const txParams: any[] = [
      windowStart.toISOString(),
      windowEnd.toISOString(),
    ];
    let hubFilterSql = '';
    if (hubId) {
      txParams.push(hubId);
      hubFilterSql = `AND COALESCE(tx."hubId", o."originHubId", o."currentHubId") = $${txParams.length}`;
    }

    const rawTxRows: Array<{
      txId: number;
      tripCode: string;
      invoiceCode: string | null;
      txType: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
      confirmedAt: Date;
      hubId: number;
      hubCode: string | null;
      hubName: string | null;
      hubLevel: number | null;
      licensePlate: string | null;
      driverName: string | null;
      destination: string | null;
      notes: string | null;
      orderId: number;
      orderCode: string;
      goodsDescription: string | null;
      originHub: string | null;
      destinationHub: string | null;
      route: string | null;
      quantity: number;
      totalOrderQuantity: number;
      effWeightKg: number;
      effVolumeCbm: number;
    }> = await this.dataSource.query(
      `
      SELECT
        tx.id AS "txId",
        COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), 'TX-' || tx.id::text) AS "tripCode",
        tx."invoiceCode" AS "invoiceCode",
        tx."type" AS "txType",
        tx."createdAt" AS "confirmedAt",
        COALESCE(tx."hubId", o."originHubId", o."currentHubId")::int AS "hubId",
        h."code" AS "hubCode",
        COALESCE(h."name", 'Kho vận hành') AS "hubName",
        COALESCE(h."level", 1)::int AS "hubLevel",
        tx."licensePlate" AS "licensePlate",
        tx."driverName" AS "driverName",
        tx."destination" AS "destination",
        tx."notes" AS "notes",
        o.id AS "orderId",
        o."orderCode" AS "orderCode",
        o."goodsDescription" AS "goodsDescription",
        o."originHub" AS "originHub",
        o."destinationHub" AS "destinationHub",
        o."route" AS "route",
        COALESCE(tx."quantity", 0)::int AS "quantity",
        COALESCE(o."totalQuantity", tx."quantity", 0)::int AS "totalOrderQuantity",
        CASE
          WHEN COALESCE(tx."weight", 0) > 0 THEN tx."weight"::float
          WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalWeight", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
          ELSE 0::float
        END AS "effWeightKg",
        CASE
          WHEN COALESCE(tx."volume", 0) > 0 THEN tx."volume"::float
          WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalVolume", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
          ELSE 0::float
        END AS "effVolumeCbm"
      FROM "order_inventory_transaction" tx
      INNER JOIN "order" o ON o.id = tx."orderId" AND o."deletedAt" IS NULL
      LEFT JOIN "hub" h ON h.id = COALESCE(tx."hubId", o."originHubId", o."currentHubId")
      WHERE tx."deletedAt" IS NULL
        AND tx."type" IN ('INBOUND', 'OUTBOUND', 'TRANSFER')
        AND tx."createdAt" >= $1
        AND tx."createdAt" < $2
        ${hubFilterSql}
      ORDER BY tx."createdAt" DESC, tx.id DESC
      `,
      txParams,
    );

    // Group transactions into distinct Confirmed Trips (`tripCode` + `hubId` + `IN`/`OUT`)
    interface GroupedTrip {
      tripKey: string;
      tripCode: string;
      invoiceCode: string | null;
      reportDate: string;
      fullDateLabel: string;
      windowLabel: string;
      confirmedAt: string;
      direction: 'INBOUND' | 'OUTBOUND' | 'TRANSFER';
      isInbound: boolean;
      hubId: number;
      hubCode: string | null;
      hubName: string;
      hubLevel: number;
      licensePlate: string | null;
      driverName: string | null;
      destination: string | null;
      orderIds: Set<number>;
      orderCount: number;
      packageCount: number;
      weightKg: number;
      weightTons: number;
      volumeCbm: number;
      orders: Array<{
        txId: number;
        orderId: number;
        orderCode: string;
        goodsDescription: string | null;
        originHub: string | null;
        destinationHub: string | null;
        route: string | null;
        quantity: number;
        totalOrderQuantity: number;
        weightKg: number;
        volumeCbm: number;
        confirmedAt: string;
        notes: string | null;
      }>;
    }

    const tripMap = new Map<string, GroupedTrip>();
    for (const r of rawTxRows) {
      const dirBucket = r.txType === 'INBOUND' ? 'IN' : 'OUT';
      const groupKey = `${r.tripCode}::${r.hubId || 0}::${dirBucket}`;
      const confirmedIso =
        r.confirmedAt instanceof Date
          ? r.confirmedAt.toISOString()
          : new Date(r.confirmedAt).toISOString();
      const wtKg = Math.round((Number(r.effWeightKg) || 0) * 100) / 100;
      const volCbm = Math.round((Number(r.effVolumeCbm) || 0) * 100) / 100;

      let group = tripMap.get(groupKey);
      if (!group) {
        group = {
          tripKey: groupKey,
          tripCode: r.tripCode,
          invoiceCode: r.invoiceCode || null,
          reportDate,
          fullDateLabel,
          windowLabel,
          confirmedAt: confirmedIso,
          direction: r.txType,
          isInbound: r.txType === 'INBOUND',
          hubId: Number(r.hubId) || 0,
          hubCode: r.hubCode || null,
          hubName: r.hubName || 'Kho vận hành',
          hubLevel: Number(r.hubLevel) || 1,
          licensePlate: r.licensePlate || null,
          driverName: r.driverName || null,
          destination: r.destination || null,
          orderIds: new Set<number>(),
          orderCount: 0,
          packageCount: 0,
          weightKg: 0,
          weightTons: 0,
          volumeCbm: 0,
          orders: [],
        };
        tripMap.set(groupKey, group);
      }

      if (!group.invoiceCode && r.invoiceCode) {
        group.invoiceCode = r.invoiceCode;
      }
      if (!group.licensePlate && r.licensePlate) {
        group.licensePlate = r.licensePlate;
      }
      if (!group.driverName && r.driverName) {
        group.driverName = r.driverName;
      }
      if (!group.destination && r.destination) {
        group.destination = r.destination;
      }
      if (confirmedIso > group.confirmedAt) {
        group.confirmedAt = confirmedIso;
      }

      group.orderIds.add(Number(r.orderId));
      group.orderCount = group.orderIds.size;
      group.packageCount += Number(r.quantity) || 0;
      group.weightKg = Math.round((group.weightKg + wtKg) * 100) / 100;
      group.weightTons = Math.round((group.weightKg / 1000) * 100) / 100;
      group.volumeCbm = Math.round((group.volumeCbm + volCbm) * 10) / 10;

      group.orders.push({
        txId: Number(r.txId),
        orderId: Number(r.orderId),
        orderCode: r.orderCode,
        goodsDescription: r.goodsDescription || null,
        originHub: r.originHub || null,
        destinationHub: r.destinationHub || null,
        route: r.route || null,
        quantity: Number(r.quantity) || 0,
        totalOrderQuantity: Number(r.totalOrderQuantity) || 0,
        weightKg: wtKg,
        volumeCbm: Math.round(volCbm * 10) / 10,
        confirmedAt: confirmedIso,
        notes: r.notes || null,
      });
    }

    const allDayTrips = Array.from(tripMap.values()).map((g) => {
      const { orderIds, ...rest } = g;
      void orderIds;
      return rest;
    });

    const inboundTripList = allDayTrips.filter((t) => t.isInbound);
    const outboundTripList = allDayTrips.filter((t) => !t.isInbound);

    const inboundWeightKg =
      Math.round(inboundTripList.reduce((s, t) => s + t.weightKg, 0) * 100) /
      100;
    const outboundWeightKg =
      Math.round(outboundTripList.reduce((s, t) => s + t.weightKg, 0) * 100) /
      100;
    const totalWeightKg =
      Math.round((inboundWeightKg + outboundWeightKg) * 100) / 100;

    const daySummary = {
      totalTrips: allDayTrips.length,
      totalOrders: allDayTrips.reduce((s, t) => s + t.orderCount, 0),
      totalPackages: allDayTrips.reduce((s, t) => s + t.packageCount, 0),
      totalCbm:
        Math.round(allDayTrips.reduce((s, t) => s + t.volumeCbm, 0) * 10) / 10,
      totalWeightKg,
      totalTons: Math.round((totalWeightKg / 1000) * 100) / 100,
      inboundTrips: inboundTripList.length,
      inboundOrders: inboundTripList.reduce((s, t) => s + t.orderCount, 0),
      inboundPackages: inboundTripList.reduce((s, t) => s + t.packageCount, 0),
      inboundCbm:
        Math.round(inboundTripList.reduce((s, t) => s + t.volumeCbm, 0) * 10) /
        10,
      inboundWeightKg,
      inboundTons: Math.round((inboundWeightKg / 1000) * 100) / 100,
      outboundTrips: outboundTripList.length,
      transferTrips: outboundTripList.filter((t) => t.direction === 'TRANSFER')
        .length,
      directOutboundTrips: outboundTripList.filter(
        (t) => t.direction === 'OUTBOUND',
      ).length,
      outboundOrders: outboundTripList.reduce((s, t) => s + t.orderCount, 0),
      outboundPackages: outboundTripList.reduce(
        (s, t) => s + t.packageCount,
        0,
      ),
      outboundCbm:
        Math.round(outboundTripList.reduce((s, t) => s + t.volumeCbm, 0) * 10) /
        10,
      outboundWeightKg,
      outboundTons: Math.round((outboundWeightKg / 1000) * 100) / 100,
      activeHubCount: new Set(allDayTrips.map((t) => t.hubId)).size,
    };

    // Per-Hub summary for this day
    const hubDayMap = new Map<
      number,
      {
        hubId: number;
        hubCode: string | null;
        hubName: string;
        hubLevel: number;
        inboundTrips: number;
        inboundCbm: number;
        inboundTons: number;
        inboundPackages: number;
        outboundTrips: number;
        outboundCbm: number;
        outboundTons: number;
        outboundPackages: number;
        totalTrips: number;
      }
    >();

    for (const t of allDayTrips) {
      let hs = hubDayMap.get(t.hubId);
      if (!hs) {
        hs = {
          hubId: t.hubId,
          hubCode: t.hubCode,
          hubName: t.hubName,
          hubLevel: t.hubLevel,
          inboundTrips: 0,
          inboundCbm: 0,
          inboundTons: 0,
          inboundPackages: 0,
          outboundTrips: 0,
          outboundCbm: 0,
          outboundTons: 0,
          outboundPackages: 0,
          totalTrips: 0,
        };
        hubDayMap.set(t.hubId, hs);
      }
      hs.totalTrips += 1;
      if (t.isInbound) {
        hs.inboundTrips += 1;
        hs.inboundCbm = Math.round((hs.inboundCbm + t.volumeCbm) * 10) / 10;
        hs.inboundTons =
          Math.round((hs.inboundTons + t.weightTons) * 100) / 100;
        hs.inboundPackages += t.packageCount;
      } else {
        hs.outboundTrips += 1;
        hs.outboundCbm = Math.round((hs.outboundCbm + t.volumeCbm) * 10) / 10;
        hs.outboundTons =
          Math.round((hs.outboundTons + t.weightTons) * 100) / 100;
        hs.outboundPackages += t.packageCount;
      }
    }

    const hubSummary = Array.from(hubDayMap.values()).sort(
      (a, b) => b.totalTrips - a.totalTrips || a.hubLevel - b.hubLevel,
    );

    // Filter trips by requested direction if 'INBOUND' or 'OUTBOUND'
    const filteredTrips =
      direction === 'INBOUND'
        ? inboundTripList
        : direction === 'OUTBOUND'
          ? outboundTripList
          : allDayTrips;

    // 2. Build a 14-day quick navigation strip centered around or ending at currentOpenReportDate
    const stripEnd =
      reportDate > currentOpenReportDate ? reportDate : currentOpenReportDate;
    const stripStart = this.addDays(stripEnd, -13);
    const stripDates = this.enumerateDates(stripStart, stripEnd);

    const stripParams: any[] = [
      this.getReportWindow(stripStart).windowStart.toISOString(),
      this.getReportWindow(stripEnd).windowEnd.toISOString(),
    ];
    let stripHubSql = '';
    if (hubId) {
      stripParams.push(hubId);
      stripHubSql = `AND COALESCE(tx."hubId", o."originHubId", o."currentHubId") = $${stripParams.length}`;
    }

    const rawStripRows: Array<{
      reportDate: string;
      inboundTrips: number;
      outboundTrips: number;
      inboundOrders: number;
      outboundOrders: number;
      inboundCbm: number;
      outboundCbm: number;
      inboundWeightKg: number;
      outboundWeightKg: number;
      inboundPackages: number;
      outboundPackages: number;
      inboundTripCodes: string[] | null;
      outboundTripCodes: string[] | null;
    }> = await this.dataSource.query(
      `
      WITH tx_strip AS (
        SELECT
          TO_CHAR(tx."createdAt" + INTERVAL '1 hour', 'YYYY-MM-DD') AS "reportDate",
          tx."type" AS "txType",
          o.id AS "orderId",
          COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), 'TX-' || tx.id::text) AS "cleanTripCode",
          COALESCE(NULLIF(tx."tripCode", ''), NULLIF(tx."invoiceCode", ''), 'TX-' || tx.id::text)
            || '::' || COALESCE(tx."hubId", o."originHubId", o."currentHubId", 0)::text AS "tripHubKey",
          COALESCE(tx."quantity", 0)::int AS "qty",
          CASE
            WHEN COALESCE(tx."weight", 0) > 0 THEN tx."weight"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalWeight", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END AS "effWeightKg",
          CASE
            WHEN COALESCE(tx."volume", 0) > 0 THEN tx."volume"::float
            WHEN COALESCE(o."totalQuantity", 0) > 0 THEN (COALESCE(o."totalVolume", 0)::float * COALESCE(tx."quantity", 0)::float / o."totalQuantity"::float)
            ELSE 0::float
          END AS "effVolume"
        FROM "order_inventory_transaction" tx
        INNER JOIN "order" o ON o.id = tx."orderId" AND o."deletedAt" IS NULL
        WHERE tx."deletedAt" IS NULL
          AND tx."type" IN ('INBOUND', 'OUTBOUND', 'TRANSFER')
          AND tx."createdAt" >= $1
          AND tx."createdAt" < $2
          ${stripHubSql}
      )
      SELECT
        "reportDate",
        COUNT(DISTINCT "tripHubKey") FILTER (WHERE "txType" = 'INBOUND')::int AS "inboundTrips",
        COUNT(DISTINCT "tripHubKey") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER'))::int AS "outboundTrips",
        COUNT(DISTINCT "orderId") FILTER (WHERE "txType" = 'INBOUND')::int AS "inboundOrders",
        COUNT(DISTINCT "orderId") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER'))::int AS "outboundOrders",
        COALESCE(SUM("effVolume") FILTER (WHERE "txType" = 'INBOUND'), 0)::float AS "inboundCbm",
        COALESCE(SUM("effVolume") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::float AS "outboundCbm",
        COALESCE(SUM("effWeightKg") FILTER (WHERE "txType" = 'INBOUND'), 0)::float AS "inboundWeightKg",
        COALESCE(SUM("effWeightKg") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::float AS "outboundWeightKg",
        COALESCE(SUM("qty") FILTER (WHERE "txType" = 'INBOUND'), 0)::int AS "inboundPackages",
        COALESCE(SUM("qty") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), 0)::int AS "outboundPackages",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT "cleanTripCode") FILTER (WHERE "txType" = 'INBOUND'), NULL) AS "inboundTripCodes",
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT "cleanTripCode") FILTER (WHERE "txType" IN ('OUTBOUND', 'TRANSFER')), NULL) AS "outboundTripCodes"
      FROM tx_strip
      GROUP BY "reportDate"
      `,
      stripParams,
    );

    const stripMap = new Map<string, (typeof rawStripRows)[number]>();
    for (const sr of rawStripRows) {
      stripMap.set(sr.reportDate, sr);
    }

    const recentDaysStrip = stripDates.map((d) => {
      const sr = stripMap.get(d);
      const [, mS, dS] = d.split('-');
      const inTrips = Number(sr?.inboundTrips) || 0;
      const outTrips = Number(sr?.outboundTrips) || 0;
      const inOrders = Number(sr?.inboundOrders) || 0;
      const outOrders = Number(sr?.outboundOrders) || 0;
      const inCbm = Math.round((Number(sr?.inboundCbm) || 0) * 10) / 10;
      const outCbm = Math.round((Number(sr?.outboundCbm) || 0) * 10) / 10;
      const inWeightKg =
        Math.round((Number(sr?.inboundWeightKg) || 0) * 100) / 100;
      const outWeightKg =
        Math.round((Number(sr?.outboundWeightKg) || 0) * 100) / 100;
      const inTons = Math.round((inWeightKg / 1000) * 100) / 100;
      const outTons = Math.round((outWeightKg / 1000) * 100) / 100;
      const inPkgs = Number(sr?.inboundPackages) || 0;
      const outPkgs = Number(sr?.outboundPackages) || 0;
      return {
        reportDate: d,
        dayLabel: `${dS}/${mS}`,
        fullDateLabel: d.split('-').reverse().join('/'),
        windowLabel: this.getReportWindow(d).windowLabel,
        inboundTrips: inTrips,
        outboundTrips: outTrips,
        totalTrips: inTrips + outTrips,
        inboundOrders: inOrders,
        outboundOrders: outOrders,
        totalOrders: inOrders + outOrders,
        inboundCbm: inCbm,
        outboundCbm: outCbm,
        totalCbm: Math.round((inCbm + outCbm) * 10) / 10,
        inboundWeightKg: inWeightKg,
        outboundWeightKg: outWeightKg,
        totalWeightKg: Math.round((inWeightKg + outWeightKg) * 100) / 100,
        inboundTons: inTons,
        outboundTons: outTons,
        totalTons: Math.round(((inWeightKg + outWeightKg) / 1000) * 100) / 100,
        inboundPackages: inPkgs,
        outboundPackages: outPkgs,
        totalPackages: inPkgs + outPkgs,
        inboundTripCodes: Array.isArray(sr?.inboundTripCodes)
          ? sr.inboundTripCodes
          : [],
        outboundTripCodes: Array.isArray(sr?.outboundTripCodes)
          ? sr.outboundTripCodes
          : [],
      };
    });

    // 3. Query unconfirmed / draft trips (`status = 'PENDING'`) for Cut-off 18:00 Alert
    const includeActiveBacklog = reportDate >= latestClosedReportDate;
    const pendingParams: any[] = [
      windowStart.toISOString(),
      windowEnd.toISOString(),
      includeActiveBacklog,
    ];
    let pendingHubSql = '';
    if (hubId) {
      pendingParams.push(hubId);
      pendingHubSql = `AND COALESCE(t."originHubId", o."originHubId", o."currentHubId") = $${pendingParams.length}`;
    }
    let pendingDirSql = '';
    if (direction === 'INBOUND') {
      pendingDirSql = `AND COALESCE(t."type", 'INBOUND') = 'INBOUND'`;
    } else if (direction === 'OUTBOUND') {
      pendingDirSql = `AND COALESCE(t."type", 'OUTBOUND') IN ('OUTBOUND', 'TRANSFER')`;
    }

    const rawPendingRows: Array<{
      tripCode: string;
      tripType: string;
      status: string;
      licensePlate: string | null;
      driverName: string | null;
      hubId: number;
      hubCode: string | null;
      hubName: string;
      hubLevel: number;
      orderCount: number;
      packageCount: number;
      weightKg: number;
      volumeCbm: number;
      createdAt: Date;
    }> = await this.dataSource.query(
      `
      SELECT
        COALESCE(NULLIF(t."tripCode", ''), 'DRAFT-' || t.id::text) AS "tripCode",
        COALESCE(MAX(t."type"), 'OUTBOUND') AS "tripType",
        COALESCE(MAX(t."status"), 'PENDING') AS "status",
        MAX(t."licensePlate") AS "licensePlate",
        MAX(t."driverName") AS "driverName",
        COALESCE(MAX(t."originHubId"), MAX(o."originHubId"), MAX(o."currentHubId"), 0)::int AS "hubId",
        MAX(h."code") AS "hubCode",
        COALESCE(MAX(h."name"), 'Kho vận hành') AS "hubName",
        COALESCE(MAX(h."level"), 1)::int AS "hubLevel",
        COUNT(DISTINCT t."orderId")::int AS "orderCount",
        COALESCE(SUM(COALESCE(t."quantityAllocated", o."totalQuantity", 0)), 0)::int AS "packageCount",
        COALESCE(SUM(CASE WHEN COALESCE(t."weightAllocated", 0) > 0 THEN t."weightAllocated"::float ELSE COALESCE(o."totalWeight", 0)::float END), 0)::float AS "weightKg",
        COALESCE(SUM(CASE WHEN COALESCE(t."volumeAllocated", 0) > 0 THEN t."volumeAllocated"::float ELSE COALESCE(o."totalVolume", 0)::float END), 0)::float AS "volumeCbm",
        MAX(t."createdAt") AS "createdAt"
      FROM "trip" t
      INNER JOIN "order" o ON o.id = t."orderId" AND o."deletedAt" IS NULL
      LEFT JOIN "hub" h ON h.id = COALESCE(t."originHubId", o."originHubId", o."currentHubId")
      WHERE t."deletedAt" IS NULL
        AND t."status" = 'PENDING'
        AND (
          (t."createdAt" >= $1 AND t."createdAt" < $2)
          OR ($3::boolean = true AND t."createdAt" < $2)
        )
        AND NOT EXISTS (
          SELECT 1 FROM "order_inventory_transaction" tx
          WHERE tx."deletedAt" IS NULL
            AND tx."tripCode" IS NOT NULL
            AND tx."tripCode" = t."tripCode"
        )
        ${pendingHubSql}
        ${pendingDirSql}
      GROUP BY COALESCE(NULLIF(t."tripCode", ''), 'DRAFT-' || t.id::text)
      ORDER BY MAX(t."createdAt") DESC
      LIMIT 30
      `,
      pendingParams,
    );

    const pendingTrips = rawPendingRows.map((p) => {
      const wtKg = Math.round((Number(p.weightKg) || 0) * 100) / 100;
      const volCbm = Math.round((Number(p.volumeCbm) || 0) * 10) / 10;
      const directionVal: 'INBOUND' | 'OUTBOUND' | 'TRANSFER' =
        p.tripType === 'INBOUND'
          ? 'INBOUND'
          : p.tripType === 'TRANSFER'
            ? 'TRANSFER'
            : 'OUTBOUND';
      return {
        tripCode: p.tripCode,
        direction: directionVal,
        status: p.status || 'PENDING',
        hubId: Number(p.hubId) || 0,
        hubCode: p.hubCode || null,
        hubName: p.hubName || 'Kho vận hành',
        hubLevel: Number(p.hubLevel) || 1,
        licensePlate: p.licensePlate || null,
        driverName: p.driverName || null,
        orderCount: Number(p.orderCount) || 0,
        packageCount: Number(p.packageCount) || 0,
        weightKg: wtKg,
        weightTons: Math.round((wtKg / 1000) * 100) / 100,
        volumeCbm: volCbm,
        createdAt:
          p.createdAt instanceof Date
            ? p.createdAt.toISOString()
            : new Date(p.createdAt).toISOString(),
      };
    });

    return {
      filter: {
        reportDate,
        fullDateLabel,
        prevReportDate: this.addDays(reportDate, -1),
        nextReportDate: this.addDays(reportDate, 1),
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        windowLabel,
        isClosed: windowEnd.getTime() <= now.getTime(),
        isCurrentOpen: reportDate === currentOpenReportDate,
        hubId: hubId ?? 'ALL',
        hubName: selectedHub
          ? selectedHub.name
          : 'Tất cả Chi nhánh (Toàn hệ thống)',
        direction,
      },
      daySummary: {
        ...daySummary,
        inboundTripCodes: inboundTripList.map((t) => t.tripCode),
        outboundTripCodes: outboundTripList.map((t) => t.tripCode),
        pendingTripsCount: pendingTrips.length,
      },
      hubSummary,
      trips: filteredTrips,
      inboundTripsList: inboundTripList,
      outboundTripsList: outboundTripList,
      pendingTrips,
      recentDaysStrip,
    };
  }

  // =========================================================================================
  // ── PHÂN HỆ CÂN ĐỐI TẢI TRỌNG ĐỘI XE THEO MIỀN (REGIONAL DISPATCH CAPACITY REPORT) ───────
  // =========================================================================================

  /**
   * Helper tính toán gợi ý phương tiện vận tải từ tổng khối lượng (tấn) và thể tích (khối)
   */
  public getVehicleRecommendation(
    weightTons: number,
    volumeCbm: number,
  ): string {
    if (weightTons <= 0 && volumeCbm <= 0) return 'Chưa có hàng';
    if (weightTons >= 25 || volumeCbm >= 65) {
      const conts = Math.max(1, Math.round(weightTons / 25));
      return `Cần ~${conts} Container 40ft (hoặc xe đầu kéo)`;
    }
    if (weightTons >= 15 || volumeCbm >= 40) {
      return 'Cần 01 Xe tải 15 Tấn';
    }
    if (weightTons >= 8 || volumeCbm >= 22) {
      return 'Cần 01 Xe tải 8 Tấn';
    }
    if (weightTons >= 3.5 || volumeCbm >= 12) {
      return 'Cần 01 Xe tải 5 Tấn (hoặc ghép chuyến)';
    }
    if (weightTons >= 1.5) {
      return 'Cần 01 Xe tải 2.5 Tấn / Xe bo trung chuyển';
    }
    return 'Lượng hàng ít (< 1.5T) - Ưu tiên ghép xe chạy ngang';
  }

  /**
   * Sinh đoạn tin nhắn nhanh (Quick Snippet) định dạng sẵn để copy gửi Zalo/Telegram cho đội xe
   */
  public generateRegionalQuickSnippet(params: {
    regionName: string;
    hubName: string;
    onhandWeightKg: number;
    onhandPackageCount: number;
    onhandVolumeCbm: number;
    incomingWeightKg: number;
    incomingTripCount: number;
    totalWeightKg: number;
    totalVolumeCbm: number;
    recommendedVehicle: string;
  }): string {
    const onhandTons = (params.onhandWeightKg / 1000).toFixed(2);
    const incomingTons = (params.incomingWeightKg / 1000).toFixed(2);
    const totalTons = (params.totalWeightKg / 1000).toFixed(2);

    return [
      `[THÔNG BÁO TẢI HÀNG ${params.regionName.toUpperCase()} - ${params.hubName.toUpperCase()}]`,
      `- Hàng sẵn tại kho: ${onhandTons} Tấn (${params.onhandPackageCount} kiện • ${params.onhandVolumeCbm.toFixed(1)} m³)`,
      `- Hàng đang về thêm: ${incomingTons} Tấn (${params.incomingTripCount} xe đang về)`,
      `👉 TỔNG TẢI DỰ KIẾN: ${totalTons} TẤN (${params.totalVolumeCbm.toFixed(1)} m³)`,
      `🚚 Đề xuất điều xe: ${params.recommendedVehicle}`,
    ].join('\n');
  }

  /**
   * Tính toán và lưu snapshot dữ liệu cân đối tải trọng đội xe theo miền vào database.
   * Kích hoạt tự động bởi Cronjob hoặc Super Admin bấm đồng bộ thủ công.
   */
  public async calculateRegionalDispatchSnapshot(options?: {
    hubId?: number;
    date?: string;
    triggeredBy?: 'CRON' | 'MANUAL';
  }): Promise<{ success: boolean; rowsProcessed: number; reportDate: string }> {
    await this.ensureTableExists();

    const now = new Date();
    const vnParts = this.getVietnamDateParts(now);
    const reportDate =
      options?.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date.trim())
        ? options.date.trim()
        : `${vnParts.year}-${String(vnParts.month).padStart(2, '0')}-${String(vnParts.day).padStart(2, '0')}`;

    const triggeredBy = options?.triggeredBy || 'CRON';

    // ── Backfill destinationRegion cho các orders chưa được phân vùng ──────────
    // Dùng normalizeRegion() (TypeScript util) thay vì SQL CASE/WHEN để đảm bảo
    // logic phân vùng luôn nhất quán với @BeforeInsert/@BeforeUpdate của OrderEntity.
    // Chỉ cập nhật các orders còn NULL / rỗng / 'N/A' — không ghi đè dữ liệu đúng.
    try {
      const unregionedOrders = await this.dataSource.query<
        { id: number; province: string }[]
      >(`
        SELECT id, province FROM "order"
        WHERE "deletedAt" IS NULL
          AND "province" IS NOT NULL
          AND ("destinationRegion" IS NULL OR "destinationRegion" = '' OR "destinationRegion" = 'N/A')
      `);

      if (unregionedOrders.length > 0) {
        // Phân nhóm theo miền để batch UPDATE thay vì N lần UPDATE riêng lẻ
        const regionGroups = new Map<string, number[]>();
        for (const ord of unregionedOrders) {
          const { region } = normalizeRegion(ord.province);
          const existing = regionGroups.get(region) ?? [];
          existing.push(ord.id);
          regionGroups.set(region, existing);
        }

        for (const [region, ids] of regionGroups.entries()) {
          if (ids.length === 0) continue;
          const idList = ids.join(',');
          await this.dataSource.query(`
            UPDATE "order"
            SET "destinationRegion" = '${region}'
            WHERE id IN (${idList})
          `);
        }

        this.logger.debug(
          `[REGIONAL_SNAPSHOT] Backfill destinationRegion: ${unregionedOrders.length} orders → ${regionGroups.size} nhóm miền`,
        );
      }
    } catch (backfillErr) {
      this.logger.warn(
        `[REGIONAL_SNAPSHOT] Backfill destinationRegion thất bại (không ảnh hưởng snapshot): ${(backfillErr as Error)?.message}`,
      );
    }
    // ────────────────────────────────────────────────────────────────────────────

    const rawStoredOrders = await this.dataSource.query(
      `
      SELECT 
        o.id,
        o."orderCode",
        o."province",
        o."destinationRegion",
        o."destinationHub",
        o."remainingQuantity",
        o."totalQuantity",
        o."totalWeight",
        o."totalVolume",
        stock."hubId" AS "currentHubId",
        stock."hubStock"
      FROM "order" o
      JOIN LATERAL (
        SELECT tx."hubId",
               SUM(CASE WHEN tx.type = 'INBOUND' THEN tx.quantity
                        WHEN tx.type IN ('OUTBOUND', 'TRANSFER') THEN -tx.quantity
                        ELSE 0 END)::int AS "hubStock"
        FROM "order_inventory_transaction" tx
        WHERE tx."orderId" = o.id
          AND tx."deletedAt" IS NULL
        GROUP BY tx."hubId"
        HAVING SUM(CASE WHEN tx.type = 'INBOUND' THEN tx.quantity
                        WHEN tx.type IN ('OUTBOUND', 'TRANSFER') THEN -tx.quantity
                        ELSE 0 END) > 0
      ) stock ON TRUE
      WHERE o."deletedAt" IS NULL
        AND NOT (
          o.status IN ('DRAFT', 'PENDING', 'WAITING')
          AND COALESCE(o."currentHubId", o."originHubId") = stock."hubId"
        )
        AND ($1::integer IS NULL OR stock."hubId" = $1)
    `,
      [options?.hubId ?? null],
    );

    const rawDraftOrders = await this.dataSource.query(
      `
      WITH warehouse_contexts AS (
        SELECT o.id AS "orderId", o."originHubId" AS "hubId"
        FROM "order" o
        WHERE o."deletedAt" IS NULL AND o."originHubId" IS NOT NULL
        UNION
        SELECT o.id, o."currentHubId" FROM "order" o
        WHERE o."deletedAt" IS NULL AND o."currentHubId" IS NOT NULL
        UNION
        SELECT o.id, o."destinationHubId" FROM "order" o
        WHERE o."deletedAt" IS NULL AND o."destinationHubId" IS NOT NULL
        UNION
        SELECT tx."orderId", tx."hubId" FROM "order_inventory_transaction" tx
        JOIN "order" o ON o.id = tx."orderId"
        WHERE o."deletedAt" IS NULL AND tx."deletedAt" IS NULL AND tx."hubId" IS NOT NULL
        UNION
        SELECT o.id, stop."hubId"
        FROM "order" o
        JOIN "trip_stop" stop
          ON stop."tripCode" = o."currentTripCode"
         AND stop."deletedAt" IS NULL
        WHERE o."deletedAt" IS NULL
      )
      SELECT o.id, o."orderCode", o.province, o."destinationRegion",
             o."destinationHub", o."totalQuantity", o."totalWeight",
             o."totalVolume", contexts."hubId"
      FROM warehouse_contexts contexts
      JOIN "order" o ON o.id = contexts."orderId"
      WHERE ($1::integer IS NULL OR contexts."hubId" = $1)
        AND (
          (o.status IN ('DRAFT', 'PENDING', 'WAITING')
           AND COALESCE(o."currentHubId", o."originHubId") = contexts."hubId")
          OR (o.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING')
              AND NOT EXISTS (
                SELECT 1 FROM "order_inventory_transaction" stock_tx
                WHERE stock_tx."orderId" = o.id
                  AND stock_tx."hubId" = contexts."hubId"
                  AND stock_tx."deletedAt" IS NULL
                GROUP BY stock_tx."orderId", stock_tx."hubId"
                HAVING SUM(CASE WHEN stock_tx.type = 'INBOUND' THEN stock_tx.quantity
                                WHEN stock_tx.type IN ('OUTBOUND', 'TRANSFER') THEN -stock_tx.quantity
                                ELSE 0 END) > 0
              ))
          OR EXISTS (
            SELECT 1 FROM "trip_stop" pending_stop
            WHERE pending_stop."tripCode" = o."currentTripCode"
              AND pending_stop."hubId" = contexts."hubId"
              AND pending_stop.status = 'PENDING'
              AND pending_stop."deletedAt" IS NULL
              AND (o."destinationHubId" = pending_stop."hubId"
                   OR o."destinationHubId" IS NULL
                   OR NOT EXISTS (
                     SELECT 1 FROM "trip_stop" final_stop
                     WHERE final_stop."tripCode" = pending_stop."tripCode"
                       AND final_stop."hubId" = o."destinationHubId"
                       AND final_stop."deletedAt" IS NULL
                   ))
          )
        )
    `,
      [options?.hubId ?? null],
    );

    const hubFilterTrips = options?.hubId
      ? `AND (
          (t.type = 'TRANSFER' AND t."destinationHubId" = ${options.hubId})
          OR (t.type = 'INBOUND' AND t."originHubId" = ${options.hubId})
        )`
      : '';
    const rawIncomingTrips = await this.dataSource.query(`
      SELECT 
        t.id AS "tripId",
        t."tripCode",
        t.type AS "tripType",
        t."status",
        CASE WHEN t.type = 'TRANSFER' THEN t."destinationHubId" ELSE t."originHubId" END AS "effectiveHubId",
        t."weightAllocated",
        t."volumeAllocated",
        t."quantityAllocated",
        o.id AS "orderId",
        o."orderCode",
        o."province",
        o."destinationRegion",
        o."destinationHub",
        o."totalWeight",
        o."totalVolume",
        o."totalQuantity",
        dest.name AS "destHubName"
      FROM "trip" t
      LEFT JOIN "order" o ON o.id = t."orderId"
      LEFT JOIN "hub" dest ON dest.id = CASE WHEN t.type = 'TRANSFER' THEN t."destinationHubId" ELSE t."originHubId" END
      WHERE t."deletedAt" IS NULL
        AND (
          (t.type = 'TRANSFER' AND t.status IN ('IN_TRANSIT', 'DISPATCHED') AND t."destinationHubId" IS NOT NULL)
          OR (t.type = 'INBOUND' AND t.status = 'PENDING')
        )
        ${hubFilterTrips}
    `);

    const hubs = await this.hubRepository.find({
      where: options?.hubId ? { id: options.hubId } : {},
      select: ['id'],
    });

    const targetRegions = [
      RegionEnum.NORTH,
      RegionEnum.CENTRAL,
      RegionEnum.SOUTH,
      RegionEnum.STORAGE,
      RegionEnum.NA,
    ];
    const hubRegionMap = new Map<
      string,
      {
        hubId: number;
        region: string;
        onhandWeightKg: number;
        onhandVolumeCbm: number;
        onhandPackageCount: number;
        onhandOrderCount: number;
        draftWeightKg: number;
        draftVolumeCbm: number;
        draftOrderCount: number;
        onhandOrderCodes: Set<string>;
        draftOrderCodes: Set<string>;
        incomingWeightKg: number;
        incomingVolumeCbm: number;
        incomingPackageCount: number;
        incomingTripIds: Set<number>;
      }
    >();

    for (const h of hubs) {
      for (const reg of targetRegions) {
        hubRegionMap.set(`${h.id}:::${reg}`, {
          hubId: h.id,
          region: reg,
          onhandWeightKg: 0,
          onhandVolumeCbm: 0,
          onhandPackageCount: 0,
          onhandOrderCount: 0,
          draftWeightKg: 0,
          draftVolumeCbm: 0,
          draftOrderCount: 0,
          onhandOrderCodes: new Set(),
          draftOrderCodes: new Set(),
          incomingWeightKg: 0,
          incomingVolumeCbm: 0,
          incomingPackageCount: 0,
          incomingTripIds: new Set(),
        });
      }
    }

    for (const ord of rawStoredOrders) {
      const hId = Number(ord.currentHubId);
      let resolvedReg = ord.destinationRegion;
      if (!resolvedReg || resolvedReg === RegionEnum.NA) {
        resolvedReg = normalizeRegion(ord.province).region;
      }
      if (resolvedReg === RegionEnum.NA && ord.destinationHub) {
        resolvedReg = normalizeRegion(ord.destinationHub).region;
      }

      const target =
        hubRegionMap.get(`${hId}:::${resolvedReg}`) ||
        hubRegionMap.get(`${hId}:::${RegionEnum.NA}`);
      if (!target) continue;

      const totalQty = Number(ord.totalQuantity) || 1;
      const hubStock = Number(ord.hubStock) || 0;
      const ratio = totalQty > 0 ? hubStock / totalQty : 1;

      target.onhandWeightKg += (Number(ord.totalWeight) || 0) * ratio;
      target.onhandVolumeCbm += (Number(ord.totalVolume) || 0) * ratio;
      target.onhandPackageCount += hubStock;
      if (ord.orderCode) target.onhandOrderCodes.add(String(ord.orderCode));
    }

    for (const ord of rawDraftOrders) {
      const hId = Number(ord.hubId);
      let resolvedReg = ord.destinationRegion;
      if (!resolvedReg || resolvedReg === RegionEnum.NA) {
        resolvedReg = normalizeRegion(ord.province || '').region;
      }
      if (resolvedReg === RegionEnum.NA && ord.destinationHub) {
        resolvedReg = normalizeRegion(ord.destinationHub).region;
      }

      const target =
        hubRegionMap.get(`${hId}:::${resolvedReg}`) ||
        hubRegionMap.get(`${hId}:::${RegionEnum.NA}`);
      if (!target) continue;

      target.draftWeightKg += Number(ord.totalWeight) || 0;
      target.draftVolumeCbm += Number(ord.totalVolume) || 0;
      if (ord.orderCode) target.draftOrderCodes.add(String(ord.orderCode));
    }

    for (const trip of rawIncomingTrips) {
      const hId = Number(trip.effectiveHubId);
      let resolvedReg = trip.destinationRegion;
      if (!resolvedReg || resolvedReg === RegionEnum.NA) {
        resolvedReg = normalizeRegion(trip.province).region;
      }
      if (resolvedReg === RegionEnum.NA && trip.destinationHub) {
        resolvedReg = normalizeRegion(trip.destinationHub).region;
      }
      if (resolvedReg === RegionEnum.NA && trip.destHubName) {
        resolvedReg = normalizeRegion(trip.destHubName).region;
      }

      const target =
        hubRegionMap.get(`${hId}:::${resolvedReg}`) ||
        hubRegionMap.get(`${hId}:::${RegionEnum.NA}`);
      if (!target) continue;

      target.incomingWeightKg +=
        Number(trip.weightAllocated) || Number(trip.totalWeight) || 0;
      target.incomingVolumeCbm +=
        Number(trip.volumeAllocated) || Number(trip.totalVolume) || 0;
      target.incomingPackageCount +=
        Number(trip.quantityAllocated) || Number(trip.totalQuantity) || 0;
      if (trip.tripId) {
        target.incomingTripIds.add(Number(trip.tripId));
      }
    }

    const valueRows: string[] = [];
    for (const d of hubRegionMap.values()) {
      d.onhandOrderCount = d.onhandOrderCodes.size;
      d.draftOrderCount = d.draftOrderCodes.size;
      const onhandW = Math.round(d.onhandWeightKg * 100) / 100;
      const onhandV = Math.round(d.onhandVolumeCbm * 10) / 10;
      const draftW = Math.round(d.draftWeightKg * 100) / 100;
      const draftV = Math.round(d.draftVolumeCbm * 10) / 10;
      const onhandCodesJson = JSON.stringify([...d.onhandOrderCodes]).replace(
        /'/g,
        "''",
      );
      const draftCodesJson = JSON.stringify([...d.draftOrderCodes]).replace(
        /'/g,
        "''",
      );
      const incomingW = Math.round(d.incomingWeightKg * 100) / 100;
      const incomingV = Math.round(d.incomingVolumeCbm * 10) / 10;
      const totalW = Math.round((onhandW + incomingW) * 100) / 100;
      const totalV = Math.round((onhandV + incomingV) * 10) / 10;

      valueRows.push(
        `('${reportDate}', ${d.hubId}, '${d.region}', ${onhandW}, ${onhandV}, ${d.onhandPackageCount}, ${d.onhandOrderCount}, ${draftW}, ${draftV}, ${d.draftOrderCount}, '${onhandCodesJson}'::jsonb, '${draftCodesJson}'::jsonb, ${incomingW}, ${incomingV}, ${d.incomingPackageCount}, ${d.incomingTripIds.size}, ${totalW}, ${totalV}, '${triggeredBy}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );
    }

    if (valueRows.length > 0) {
      await this.dataSource.query(`
        INSERT INTO "daily_regional_dispatch_report" (
          "reportDate", "hubId", "region",
          "onhandWeightKg", "onhandVolumeCbm", "onhandPackageCount", "onhandOrderCount",
          "draftWeightKg", "draftVolumeCbm", "draftOrderCount",
          "onhandOrderCodes", "draftOrderCodes",
          "incomingWeightKg", "incomingVolumeCbm", "incomingPackageCount", "incomingTripCount",
          "totalWeightKg", "totalVolumeCbm", "triggeredBy", "calculatedAt", "createdAt", "updatedAt"
        ) VALUES 
        ${valueRows.join(',\n')}
        ON CONFLICT ("reportDate", "hubId", "region") DO UPDATE SET
          "onhandWeightKg" = EXCLUDED."onhandWeightKg",
          "onhandVolumeCbm" = EXCLUDED."onhandVolumeCbm",
          "onhandPackageCount" = EXCLUDED."onhandPackageCount",
          "onhandOrderCount" = EXCLUDED."onhandOrderCount",
          "draftWeightKg" = EXCLUDED."draftWeightKg",
          "draftVolumeCbm" = EXCLUDED."draftVolumeCbm",
          "draftOrderCount" = EXCLUDED."draftOrderCount",
          "onhandOrderCodes" = EXCLUDED."onhandOrderCodes",
          "draftOrderCodes" = EXCLUDED."draftOrderCodes",
          "incomingWeightKg" = EXCLUDED."incomingWeightKg",
          "incomingVolumeCbm" = EXCLUDED."incomingVolumeCbm",
          "incomingPackageCount" = EXCLUDED."incomingPackageCount",
          "incomingTripCount" = EXCLUDED."incomingTripCount",
          "totalWeightKg" = EXCLUDED."totalWeightKg",
          "totalVolumeCbm" = EXCLUDED."totalVolumeCbm",
          "triggeredBy" = EXCLUDED."triggeredBy",
          "calculatedAt" = EXCLUDED."calculatedAt",
          "updatedAt" = CURRENT_TIMESTAMP
      `);
    }

    return {
      success: true,
      rowsProcessed: valueRows.length,
      reportDate,
    };
  }

  /**
   * Truy xuất toàn diện Báo cáo Cân Đối Tải Trọng Đội Xe Theo Miền (Super Admin).
   * Hỗ trợ lọc theo từng Hub hoặc toàn hệ thống.
   */
  public async getRegionalDispatchReport(query: {
    hubId?: string;
    date?: string;
    fromDate?: string;
    toDate?: string;
    mode?: 'live' | 'snapshot';
  }) {
    await this.ensureTableExists();

    const now = new Date();
    const vnParts = this.getVietnamDateParts(now);
    const todayStr = `${vnParts.year}-${String(vnParts.month).padStart(2, '0')}-${String(vnParts.day).padStart(2, '0')}`;
    const legacyDate = this.sanitizeDateParam(query?.date, todayStr);
    let fromDate = this.sanitizeDateParam(
      query?.fromDate,
      query?.toDate
        ? this.sanitizeDateParam(query.toDate, legacyDate)
        : legacyDate,
    );
    let toDate = this.sanitizeDateParam(
      query?.toDate,
      query?.fromDate ? fromDate : legacyDate,
    );
    if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
    const maxToDate = this.addDays(fromDate, 365);
    if (toDate > maxToDate) toDate = maxToDate;
    let reportDate = toDate;

    const parsedHubId =
      query?.hubId && query.hubId !== 'ALL' ? Number(query.hubId) : null;

    // Lấy thông tin Hub được chọn
    let selectedHub: HubEntity | null = null;
    if (parsedHubId) {
      selectedHub = await this.hubRepository.findOne({
        where: { id: parsedHubId },
      });
    }

    const allHubs = await this.hubRepository.find({
      order: { level: 'ASC', name: 'ASC' },
    });

    // Lấy cấu hình và thời điểm chạy gần nhất của Cronjob
    const cronConfig = await this.cronConfigRepository.findOne({
      where: { jobKey: 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT' },
    });

    // Refresh only today's live row. Historical/future range days must use their own snapshots.
    if (
      query?.mode !== 'snapshot' &&
      fromDate <= todayStr &&
      toDate >= todayStr
    ) {
      await this.calculateRegionalDispatchSnapshot({
        hubId: parsedHubId || undefined,
        date: todayStr,
        triggeredBy: 'MANUAL',
      });
    } else if (
      query?.mode !== 'snapshot' &&
      !query?.fromDate &&
      !query?.toDate &&
      toDate === todayStr
    ) {
      await this.calculateRegionalDispatchSnapshot({
        hubId: parsedHubId || undefined,
        date: reportDate,
        triggeredBy: 'MANUAL',
      });
    }

    // Truy vấn dữ liệu snapshot tổng hợp từ daily_regional_dispatch_report
    const queryBuilder = this.regionalReportRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.hub', 'hub')
      .where('r.reportDate >= :fromDate AND r.reportDate <= :toDate', {
        fromDate,
        toDate,
      });

    if (parsedHubId) {
      queryBuilder.andWhere('r.hubId = :hubId', { hubId: parsedHubId });
    }

    const rangeRows = await queryBuilder
      .orderBy('r.reportDate', 'ASC')
      .addOrderBy('r.hubId', 'ASC')
      .getMany();
    if (rangeRows.length > 0) {
      reportDate = rangeRows[rangeRows.length - 1].reportDate;
    }
    const reportRows = rangeRows.filter((row) => row.reportDate === reportDate);

    // Khởi tạo cấu trúc tổng hợp cho 3 miền chính + N/A
    const initRegionSummary = (regionName: string) => ({
      region: regionName,
      onhandWeightKg: 0,
      onhandWeightTons: 0,
      onhandVolumeCbm: 0,
      onhandPackageCount: 0,
      onhandOrderCount: 0,
      draftWeightKg: 0,
      draftVolumeCbm: 0,
      draftOrderCount: 0,
      onhandOrderCodes: new Set<string>(),
      draftOrderCodes: new Set<string>(),
      incomingWeightKg: 0,
      incomingWeightTons: 0,
      incomingVolumeCbm: 0,
      incomingPackageCount: 0,
      incomingTripCount: 0,
      totalWeightKg: 0,
      totalWeightTons: 0,
      totalVolumeCbm: 0,
      recommendedVehicle: 'Chưa có hàng',
      quickSnippet: '',
    });

    const summaryMap: Record<string, ReturnType<typeof initRegionSummary>> = {
      [RegionEnum.NORTH]: initRegionSummary(RegionEnum.NORTH),
      [RegionEnum.CENTRAL]: initRegionSummary(RegionEnum.CENTRAL),
      [RegionEnum.SOUTH]: initRegionSummary(RegionEnum.SOUTH),
      [RegionEnum.STORAGE]: initRegionSummary(RegionEnum.STORAGE),
      [RegionEnum.NA]: initRegionSummary(RegionEnum.NA),
    };

    for (const row of reportRows) {
      const target = summaryMap[row.region] || summaryMap[RegionEnum.NA];
      target.onhandWeightKg += Number(row.onhandWeightKg) || 0;
      target.onhandVolumeCbm += Number(row.onhandVolumeCbm) || 0;
      target.onhandPackageCount += Number(row.onhandPackageCount) || 0;
      target.onhandOrderCount += Number(row.onhandOrderCount) || 0;
      target.draftWeightKg += Number(row.draftWeightKg) || 0;
      target.draftVolumeCbm += Number(row.draftVolumeCbm) || 0;
      target.draftOrderCount += Number(row.draftOrderCount) || 0;
      for (const code of row.onhandOrderCodes || []) {
        target.onhandOrderCodes.add(String(code));
      }
      for (const code of row.draftOrderCodes || []) {
        target.draftOrderCodes.add(String(code));
      }

      target.incomingWeightKg += Number(row.incomingWeightKg) || 0;
      target.incomingVolumeCbm += Number(row.incomingVolumeCbm) || 0;
      target.incomingPackageCount += Number(row.incomingPackageCount) || 0;
      target.incomingTripCount += Number(row.incomingTripCount) || 0;

      target.totalWeightKg += Number(row.totalWeightKg) || 0;
      target.totalVolumeCbm += Number(row.totalVolumeCbm) || 0;
    }

    const hubDisplayName = selectedHub
      ? selectedHub.name
      : 'Tất cả Chi nhánh (Toàn quốc)';

    // Hoàn tất quy đổi tấn, khuyến nghị phương tiện và Quick Snippet cho từng miền
    for (const key of Object.keys(summaryMap)) {
      const item = summaryMap[key];
      item.onhandWeightKg = Math.round(item.onhandWeightKg * 100) / 100;
      item.onhandWeightTons =
        Math.round((item.onhandWeightKg / 1000) * 100) / 100;
      item.onhandVolumeCbm = Math.round(item.onhandVolumeCbm * 10) / 10;
      item.draftWeightKg = Math.round(item.draftWeightKg * 100) / 100;
      item.draftVolumeCbm = Math.round(item.draftVolumeCbm * 10) / 10;

      item.incomingWeightKg = Math.round(item.incomingWeightKg * 100) / 100;
      item.incomingWeightTons =
        Math.round((item.incomingWeightKg / 1000) * 100) / 100;
      item.incomingVolumeCbm = Math.round(item.incomingVolumeCbm * 10) / 10;

      item.totalWeightKg =
        Math.round((item.onhandWeightKg + item.incomingWeightKg) * 100) / 100;
      item.totalWeightTons =
        Math.round((item.totalWeightKg / 1000) * 100) / 100;
      item.totalVolumeCbm =
        Math.round((item.onhandVolumeCbm + item.incomingVolumeCbm) * 10) / 10;

      item.recommendedVehicle = this.getVehicleRecommendation(
        item.totalWeightTons,
        item.totalVolumeCbm,
      );

      item.quickSnippet = this.generateRegionalQuickSnippet({
        regionName: item.region,
        hubName: hubDisplayName,
        onhandWeightKg: item.onhandWeightKg,
        onhandPackageCount: item.onhandPackageCount,
        onhandVolumeCbm: item.onhandVolumeCbm,
        incomingWeightKg: item.incomingWeightKg,
        incomingTripCount: item.incomingTripCount,
        totalWeightKg: item.totalWeightKg,
        totalVolumeCbm: item.totalVolumeCbm,
        recommendedVehicle: item.recommendedVehicle,
      });
    }

    // Tính tổng toàn hệ thống
    const grandTotals = {
      totalWeightKg:
        summaryMap[RegionEnum.NORTH].totalWeightKg +
        summaryMap[RegionEnum.CENTRAL].totalWeightKg +
        summaryMap[RegionEnum.SOUTH].totalWeightKg +
        summaryMap[RegionEnum.STORAGE].totalWeightKg +
        summaryMap[RegionEnum.NA].totalWeightKg,
      totalWeightTons: 0,
      totalVolumeCbm:
        summaryMap[RegionEnum.NORTH].totalVolumeCbm +
        summaryMap[RegionEnum.CENTRAL].totalVolumeCbm +
        summaryMap[RegionEnum.SOUTH].totalVolumeCbm +
        summaryMap[RegionEnum.STORAGE].totalVolumeCbm +
        summaryMap[RegionEnum.NA].totalVolumeCbm,
      onhandWeightKg:
        summaryMap[RegionEnum.NORTH].onhandWeightKg +
        summaryMap[RegionEnum.CENTRAL].onhandWeightKg +
        summaryMap[RegionEnum.SOUTH].onhandWeightKg +
        summaryMap[RegionEnum.STORAGE].onhandWeightKg +
        summaryMap[RegionEnum.NA].onhandWeightKg,
      incomingWeightKg:
        summaryMap[RegionEnum.NORTH].incomingWeightKg +
        summaryMap[RegionEnum.CENTRAL].incomingWeightKg +
        summaryMap[RegionEnum.SOUTH].incomingWeightKg +
        summaryMap[RegionEnum.STORAGE].incomingWeightKg +
        summaryMap[RegionEnum.NA].incomingWeightKg,
      packageCount:
        summaryMap[RegionEnum.NORTH].onhandPackageCount +
        summaryMap[RegionEnum.CENTRAL].onhandPackageCount +
        summaryMap[RegionEnum.SOUTH].onhandPackageCount +
        summaryMap[RegionEnum.STORAGE].onhandPackageCount +
        summaryMap[RegionEnum.NA].onhandPackageCount,
      orderCount:
        summaryMap[RegionEnum.NORTH].onhandOrderCount +
        summaryMap[RegionEnum.CENTRAL].onhandOrderCount +
        summaryMap[RegionEnum.SOUTH].onhandOrderCount +
        summaryMap[RegionEnum.STORAGE].onhandOrderCount +
        summaryMap[RegionEnum.NA].onhandOrderCount,
      incomingTripCount:
        summaryMap[RegionEnum.NORTH].incomingTripCount +
        summaryMap[RegionEnum.CENTRAL].incomingTripCount +
        summaryMap[RegionEnum.SOUTH].incomingTripCount +
        summaryMap[RegionEnum.STORAGE].incomingTripCount +
        summaryMap[RegionEnum.NA].incomingTripCount,
    };
    grandTotals.totalWeightTons =
      Math.round((grandTotals.totalWeightKg / 1000) * 100) / 100;
    grandTotals.totalVolumeCbm =
      Math.round(grandTotals.totalVolumeCbm * 10) / 10;

    const rowsByDate = new Map<string, DailyRegionalDispatchReportEntity[]>();
    for (const row of rangeRows) {
      const rows = rowsByDate.get(row.reportDate) || [];
      rows.push(row);
      rowsByDate.set(row.reportDate, rows);
    }
    const dailySeries = this.enumerateDates(fromDate, toDate).map((date) => {
      const rows = rowsByDate.get(date) || [];
      const sum = (key: keyof DailyRegionalDispatchReportEntity) =>
        rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
      const onhandWeightKg = sum('onhandWeightKg');
      const onhandVolumeCbm = sum('onhandVolumeCbm');
      const draftWeightKg = sum('draftWeightKg');
      const draftVolumeCbm = sum('draftVolumeCbm');
      const incomingWeightKg = sum('incomingWeightKg');
      const incomingVolumeCbm = sum('incomingVolumeCbm');
      return {
        reportDate: date,
        hasSnapshot: rows.length > 0,
        onhandWeightKg,
        onhandVolumeCbm,
        onhandOrderCount: sum('onhandOrderCount'),
        draftWeightKg,
        draftVolumeCbm,
        draftOrderCount: sum('draftOrderCount'),
        incomingWeightKg,
        incomingVolumeCbm,
        incomingTripCount: sum('incomingTripCount'),
        totalWeightKg: onhandWeightKg + draftWeightKg + incomingWeightKg,
        totalVolumeCbm: onhandVolumeCbm + draftVolumeCbm + incomingVolumeCbm,
      };
    });

    // Chi tiết danh sách chuyến xe đang chạy về kho
    const hubFilterSql = parsedHubId
      ? `AND (
          (t.type = 'TRANSFER' AND t."destinationHubId" = ${parsedHubId})
          OR (t.type = 'INBOUND' AND t."originHubId" = ${parsedHubId})
        )`
      : '';
    const rawIncomingTripsList = await this.dataSource.query(`
      SELECT 
        t.id,
        t."tripCode",
        t.type AS "tripType",
        t."licensePlate",
        t."driverName",
        t."status",
        t."originHubId",
        t."destinationHubId",
        orig.name AS "originHubName",
        dest.name AS "destinationHubName",
        COALESCE(t."weightAllocated", 0) AS "weightAllocated",
        COALESCE(t."volumeAllocated", 0) AS "volumeAllocated",
        COALESCE(t."quantityAllocated", 0) AS "quantityAllocated",
        t."estimatedDeliveryDate",
        t."createdAt",
        o."orderCode",
        o."province",
        o."destinationRegion",
        o."destinationHub"
      FROM "trip" t
      LEFT JOIN "hub" orig ON orig.id = t."originHubId"
      LEFT JOIN "hub" dest ON dest.id = CASE WHEN t.type = 'TRANSFER' THEN t."destinationHubId" ELSE t."originHubId" END
      LEFT JOIN "order" o ON o.id = t."orderId"
      WHERE t."deletedAt" IS NULL
        AND (
          (t.type = 'TRANSFER' AND t.status IN ('IN_TRANSIT', 'DISPATCHED') AND t."destinationHubId" IS NOT NULL)
          OR (t.type = 'INBOUND' AND t.status = 'PENDING')
        )
        ${hubFilterSql}
      ORDER BY t."createdAt" DESC
      LIMIT 100
    `);

    // Chi tiết danh sách đơn hàng đang tồn tại kho
    const rawStoredOrdersList = await this.dataSource.query(
      `
      SELECT 
        o.id,
        o."orderCode",
        o."province",
        o."destinationRegion",
        o."destinationHub",
        stock."hubStock" AS "remainingQuantity",
        o."totalQuantity",
        o."totalWeight",
        o."totalVolume",
        o."goodsDescription",
        o."notes",
        stock."hubId" AS "currentHubId",
        h.name AS "currentHubName"
      FROM "order" o
      JOIN LATERAL (
        SELECT tx."hubId",
               SUM(CASE WHEN tx.type = 'INBOUND' THEN tx.quantity
                        WHEN tx.type IN ('OUTBOUND', 'TRANSFER') THEN -tx.quantity
                        ELSE 0 END)::int AS "hubStock"
        FROM "order_inventory_transaction" tx
        WHERE tx."orderId" = o.id AND tx."deletedAt" IS NULL
        GROUP BY tx."hubId"
        HAVING SUM(CASE WHEN tx.type = 'INBOUND' THEN tx.quantity
                        WHEN tx.type IN ('OUTBOUND', 'TRANSFER') THEN -tx.quantity
                        ELSE 0 END) > 0
      ) stock ON TRUE
      LEFT JOIN "hub" h ON h.id = stock."hubId"
      WHERE o."deletedAt" IS NULL
        AND NOT (
          o.status IN ('DRAFT', 'PENDING', 'WAITING')
          AND COALESCE(o."currentHubId", o."originHubId") = stock."hubId"
        )
        AND ($1::integer IS NULL OR stock."hubId" = $1)
      ORDER BY o."createdAt" DESC
      LIMIT 150
    `,
      [parsedHubId],
    );

    const onhandOrdersList = rawStoredOrdersList.map((ord: any) => {
      let reg = ord.destinationRegion;
      if (!reg || reg === RegionEnum.NA) {
        reg = normalizeRegion(ord.province).region;
      }
      if (reg === RegionEnum.NA && ord.destinationHub) {
        reg = normalizeRegion(ord.destinationHub).region;
      }

      const totalQty = Number(ord.totalQuantity) || 1;
      const remainQty = Number(ord.remainingQuantity) || 0;
      const ratio = totalQty > 0 ? remainQty / totalQty : 1;
      const wKg =
        Math.round((Number(ord.totalWeight) || 0) * ratio * 100) / 100;
      const vCbm = Math.round((Number(ord.totalVolume) || 0) * ratio * 10) / 10;

      return {
        id: ord.id,
        orderCode: ord.orderCode,
        province: ord.province || 'Chưa nhập',
        region: reg,
        remainingQuantity: remainQty,
        totalQuantity: totalQty,
        weightKg: wKg,
        weightTons: Math.round((wKg / 1000) * 100) / 100,
        volumeCbm: vCbm,
        goodsDescription: ord.goodsDescription,
        currentHubId: ord.currentHubId,
        currentHubName: ord.currentHubName || 'Kho hiện tại',
      };
    });

    const incomingTripsList = rawIncomingTripsList.map((trip: any) => {
      let reg = trip.destinationRegion;
      if (!reg || reg === RegionEnum.NA) {
        reg = normalizeRegion(trip.province).region;
      }
      if (reg === RegionEnum.NA && trip.destinationHub) {
        reg = normalizeRegion(trip.destinationHub).region;
      }
      if (reg === RegionEnum.NA && trip.destinationHubName) {
        reg = normalizeRegion(trip.destinationHubName).region;
      }

      return {
        id: trip.id,
        tripCode: trip.tripCode,
        licensePlate: trip.licensePlate || 'Chưa gán xe',
        driverName: trip.driverName || 'Chưa gán tài xế',
        status: trip.status,
        originHubName: trip.originHubName || 'Kho gửi',
        destinationHubName: trip.destinationHubName || 'Kho đích',
        weightKg: Number(trip.weightAllocated) || 0,
        weightTons:
          Math.round(((Number(trip.weightAllocated) || 0) / 1000) * 100) / 100,
        volumeCbm: Number(trip.volumeAllocated) || 0,
        packageCount: Number(trip.quantityAllocated) || 0,
        orderCode: trip.orderCode,
        province: trip.province || '',
        region: reg,
        estimatedDeliveryDate: trip.estimatedDeliveryDate,
      };
    });

    const draftRegions = {
      north: {
        weightKg: summaryMap[RegionEnum.NORTH].draftWeightKg,
        volumeCbm: summaryMap[RegionEnum.NORTH].draftVolumeCbm,
        orderCount: summaryMap[RegionEnum.NORTH].draftOrderCount,
        orderCodes: [...summaryMap[RegionEnum.NORTH].draftOrderCodes],
      },
      central: {
        weightKg: summaryMap[RegionEnum.CENTRAL].draftWeightKg,
        volumeCbm: summaryMap[RegionEnum.CENTRAL].draftVolumeCbm,
        orderCount: summaryMap[RegionEnum.CENTRAL].draftOrderCount,
        orderCodes: [...summaryMap[RegionEnum.CENTRAL].draftOrderCodes],
      },
      south: {
        weightKg: summaryMap[RegionEnum.SOUTH].draftWeightKg,
        volumeCbm: summaryMap[RegionEnum.SOUTH].draftVolumeCbm,
        orderCount: summaryMap[RegionEnum.SOUTH].draftOrderCount,
        orderCodes: [...summaryMap[RegionEnum.SOUTH].draftOrderCodes],
      },
      storage: {
        weightKg: summaryMap[RegionEnum.STORAGE].draftWeightKg,
        volumeCbm: summaryMap[RegionEnum.STORAGE].draftVolumeCbm,
        orderCount: summaryMap[RegionEnum.STORAGE].draftOrderCount,
        orderCodes: [...summaryMap[RegionEnum.STORAGE].draftOrderCodes],
      },
      na: {
        weightKg: summaryMap[RegionEnum.NA].draftWeightKg,
        volumeCbm: summaryMap[RegionEnum.NA].draftVolumeCbm,
        orderCount: summaryMap[RegionEnum.NA].draftOrderCount,
        orderCodes: [...summaryMap[RegionEnum.NA].draftOrderCodes],
      },
    };

    return {
      draftRegions,
      range: { fromDate, toDate },
      dailySeries,
      hub: {
        id: selectedHub ? selectedHub.id : 0,
        code: selectedHub ? selectedHub.code : 'ALL',
        name: hubDisplayName,
        level: selectedHub ? selectedHub.level : 0,
      },
      reportDate,
      cronInfo: {
        jobKey: 'REGIONAL_DISPATCH_CAPACITY_SNAPSHOT',
        name: cronConfig?.name || 'Cân đối Tải trọng Đội xe theo Miền',
        cronTime: cronConfig?.cronTime || '17:00',
        isEnabled: cronConfig?.isEnabled ?? true,
        lastRunAt: cronConfig?.lastRunAt
          ? cronConfig.lastRunAt.toISOString()
          : null,
        lastRunStatus: cronConfig?.lastRunStatus || 'IDLE',
      },
      regions: {
        north: {
          ...summaryMap[RegionEnum.NORTH],
          onhandOrderCodes: [...summaryMap[RegionEnum.NORTH].onhandOrderCodes],
          draftOrderCodes: [...summaryMap[RegionEnum.NORTH].draftOrderCodes],
        },
        central: {
          ...summaryMap[RegionEnum.CENTRAL],
          onhandOrderCodes: [
            ...summaryMap[RegionEnum.CENTRAL].onhandOrderCodes,
          ],
          draftOrderCodes: [...summaryMap[RegionEnum.CENTRAL].draftOrderCodes],
        },
        south: {
          ...summaryMap[RegionEnum.SOUTH],
          onhandOrderCodes: [...summaryMap[RegionEnum.SOUTH].onhandOrderCodes],
          draftOrderCodes: [...summaryMap[RegionEnum.SOUTH].draftOrderCodes],
        },
        storage: {
          ...summaryMap[RegionEnum.STORAGE],
          onhandOrderCodes: [
            ...summaryMap[RegionEnum.STORAGE].onhandOrderCodes,
          ],
          draftOrderCodes: [...summaryMap[RegionEnum.STORAGE].draftOrderCodes],
        },
        na: {
          ...summaryMap[RegionEnum.NA],
          onhandOrderCodes: [...summaryMap[RegionEnum.NA].onhandOrderCodes],
          draftOrderCodes: [...summaryMap[RegionEnum.NA].draftOrderCodes],
        },
      },
      totals: grandTotals,
      hubsList: allHubs.map((h) => ({
        id: h.id,
        code: h.code,
        name: h.name,
        level: h.level,
      })),
      incomingTripsList,
      onhandOrdersList,
    };
  }
}
