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
 * Pre-aggregated daily operational report snapshot per Hub for Super Admin.
 * Each reportDate `YYYY-MM-DD` (e.g. `2026-11-02`) aggregates confirmed trips/transactions
 * within the 24-hour operational window:
 *   [ (reportDate - 1 day) 18:00:00 GMT+7 , reportDate 18:00:00 GMT+7 )
 * Based strictly on trip confirmation timestamp (`order_inventory_transaction.createdAt`),
 * never on order/draft creation timestamp.
 */
@Entity({
  name: 'daily_hub_operational_report',
})
@Unique('UQ_daily_hub_operational_report_date_hub', ['reportDate', 'hubId'])
export class DailyHubOperationalReportEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Report operational date in YYYY-MM-DD (Vietnam Time GMT+7). */
  @Index('IDX_daily_hub_op_report_reportDate')
  @Column({ type: String, length: 10, nullable: false })
  reportDate: string;

  /** Window start timestamp (UTC equivalent of D-1 18:00:00+07:00). */
  @Column({ type: 'timestamp', nullable: false })
  windowStart: Date;

  /** Window end timestamp (UTC equivalent of D 18:00:00+07:00). */
  @Column({ type: 'timestamp', nullable: false })
  windowEnd: Date;

  @Index('IDX_daily_hub_op_report_hubId')
  @Column({ type: 'int', nullable: false })
  hubId: number;

  @ManyToOne(() => HubEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'hubId',
    foreignKeyConstraintName: 'FK_daily_hub_operational_report_hub',
  })
  hub: Relation<HubEntity>;

  // ── Inbound Confirmed Metrics (Xác nhận nhập kho) ──
  @Column({ type: 'float', nullable: false, default: 0 })
  inboundVolumeCbm: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  inboundWeightKg: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  inboundPackageCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  inboundTripCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  inboundOrderCount: number;

  // ── Outbound Confirmed Metrics (Xác nhận xuất kho: Giao khách + Luân chuyển) ──
  @Column({ type: 'float', nullable: false, default: 0 })
  outboundVolumeCbm: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  outboundWeightKg: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  outboundPackageCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  outboundTripCount: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  outboundOrderCount: number;

  /** Source of aggregation: CRON | MANUAL | BACKFILL | AUTO_SYNC */
  @Column({ type: String, length: 30, nullable: false, default: 'CRON' })
  triggeredBy: string;

  @Column({
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
  })
  calculatedAt: Date;
}
