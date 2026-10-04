import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';
import { OrderEntity } from './order.entity';
import { HubEntity } from '../../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

export enum InventoryTransactionType {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  TRANSFER = 'TRANSFER',
  ADJUSTMENT = 'ADJUSTMENT',
}

@Entity({
  name: 'order_inventory_transaction',
})
export class OrderInventoryTransactionEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: Number, nullable: false })
  orderId: number;

  @ManyToOne('OrderEntity', (order: OrderEntity) => order.inventoryTransactions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order: Relation<OrderEntity>;

  @Index()
  @Column({
    type: String,
    nullable: false,
    default: InventoryTransactionType.INBOUND,
  })
  type: string;

  @Column({ type: 'int', nullable: false, default: 0 })
  quantity: number;

  @Column({ type: 'int', nullable: false, default: 0 })
  remainingQuantity: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  weight: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  volume: number;

  @Column({ type: String, nullable: true })
  licensePlate: string | null;

  @Column({ type: String, nullable: true })
  driverName: string | null;

  @Column({ type: String, nullable: true })
  destination: string | null;

  @Column({ type: Number, nullable: true })
  performedByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // ── Operational Invoice fields (Phiếu vận hành) ──
  // `quantity` above = actual quantity counted/dispatched by this invoice.

  /** PNK-HCM-2610-001 (nhập) / PXK-... (xuất luân chuyển) / PGH-... (giao khách) / DCH-... (điều chỉnh) */
  @Index('IDX_order_inventory_transaction_invoiceCode')
  @Column({ type: String, length: 50, nullable: true })
  invoiceCode: string | null;

  /** Hub that issued this invoice. Per-hub stock = SUM(INBOUND) - SUM(OUTBOUND + TRANSFER) by hubId. */
  @Index('IDX_order_inventory_transaction_hubId')
  @Column({ type: 'int', nullable: true })
  hubId: number | null;

  @ManyToOne(() => HubEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'hubId',
    foreignKeyConstraintName: 'FK_order_inventory_transaction_hub',
  })
  hub: Relation<HubEntity> | null;

  /** Trip allocation row (trip.id) related to this invoice, if any. */
  @Column({ type: 'int', nullable: true })
  tripId: number | null;

  /** Logical trip code (SD...) related to this invoice, if any. */
  @Index('IDX_order_inventory_transaction_tripCode')
  @Column({ type: String, length: 50, nullable: true })
  tripCode: string | null;

  /** Expected quantity (e.g. quantity loaded on the trip for this hub). */
  @Column({ type: 'int', nullable: true })
  expectedQuantity: number | null;

  /** actual - expected (negative = thiếu, positive = thừa). */
  @Column({ type: 'int', nullable: false, default: 0 })
  discrepancyQuantity: number;

  @Column({ type: 'text', nullable: true })
  discrepancyReason: string | null;
}
