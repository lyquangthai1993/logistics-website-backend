import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  type Relation,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';
import { HubEntity } from '../../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

/**
 * Pre-aggregated regional dispatch snapshot report per Hub and Region (Bắc, Trung, Nam, N/A).
 * Populated automatically by Cronjob `REGIONAL_DISPATCH_CAPACITY_SNAPSHOT` or manual sync by Super Admin.
 */
@Entity({
  name: 'daily_regional_dispatch_report',
})
@Unique('UQ_daily_regional_dispatch_report_date_hub_region', [
  'reportDate',
  'hubId',
  'region',
])
export class DailyRegionalDispatchReportEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Snapshot date in YYYY-MM-DD (Vietnam Time GMT+7). */
  @Index('IDX_daily_regional_report_date')
  @Column({ type: String, length: 10, nullable: false })
  reportDate: string;

  @Index('IDX_daily_regional_report_hubId')
  @Column({ type: 'int', nullable: false })
  hubId: number;

  @ManyToOne(() => HubEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'hubId',
    foreignKeyConstraintName: 'FK_daily_regional_dispatch_report_hub',
  })
  hub: Relation<HubEntity>;

  /** Region: 'MIỀN BẮC' | 'MIỀN TRUNG' | 'MIỀN NAM' | 'N/A' */
  @Index('IDX_daily_regional_report_region')
  @Column({ type: String, length: 50, nullable: false })
  region: string;

  // ── 1. Hàng đang có trong kho (On-hand / STORED) ──
  @Column({ type: 'float', nullable: false, default: 0 })
  onhandWeightKg: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  onhandVolumeCbm: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  onhandPackageCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  onhandOrderCount: number;

  // Draft orders visible in the warehouse view at snapshot time.
  @Column({ type: 'float', nullable: false, default: 0 })
  draftWeightKg: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  draftVolumeCbm: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  draftOrderCount: number;

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  onhandOrderCodes: string[];

  @Column({ type: 'jsonb', nullable: false, default: () => "'[]'::jsonb" })
  draftOrderCodes: string[];

  // ── 2. Hàng sắp về kho (Inbound In-Transit trips) ──
  @Column({ type: 'float', nullable: false, default: 0 })
  incomingWeightKg: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  incomingVolumeCbm: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  incomingPackageCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  incomingTripCount: number;

  // ── 3. Tổng tải dự kiến (Tồn kho + Sắp về) ──
  @Column({ type: 'float', nullable: false, default: 0 })
  totalWeightKg: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalVolumeCbm: number;

  @Column({ type: String, length: 30, nullable: false, default: 'CRON' })
  triggeredBy: string;

  @Column({
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
  })
  calculatedAt: Date;
}
