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
 * Current warehouse-order totals, refreshed by the per-Hub snapshot cron.
 * This is intentionally separate from daily_hub_operational_report, which is
 * an immutable movement report for a 06:00 -> 05:59 operational window.
 */
@Entity({ name: 'warehouse_hub_order_summary' })
@Unique('UQ_warehouse_hub_order_summary_hubId_status', ['hubId', 'status'])
export class WarehouseHubOrderSummaryEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_warehouse_hub_order_summary_hubId')
  @Column({ type: 'int', nullable: false })
  hubId: number;

  @ManyToOne(() => HubEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'hubId',
    foreignKeyConstraintName: 'FK_warehouse_hub_order_summary_hub',
  })
  hub: Relation<HubEntity>;

  /** Snapshot bucket consumed by the warehouse orders tabs. */
  @Index('IDX_warehouse_hub_order_summary_status')
  @Column({ type: 'varchar', length: 32, nullable: false, default: 'ALL' })
  status: 'ALL' | 'INBOUND' | 'DRAFT' | 'COMPLETED_INBOUND';

  @Column({ type: 'int', nullable: false, default: 0 })
  totalQuantity: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalWeightKg: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalVolumeCbm: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  orderCount: number;

  @Column({ type: 'varchar', length: 30, nullable: false, default: 'CRON' })
  triggeredBy: string;

  @Column({
    type: 'timestamp',
    nullable: false,
    default: () => 'CURRENT_TIMESTAMP',
  })
  calculatedAt: Date;
}
