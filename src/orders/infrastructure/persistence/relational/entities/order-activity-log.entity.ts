import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { OrderEntity } from './order.entity';

export enum OrderActivityAction {
  ORDER_CREATED = 'ORDER_CREATED',
  INBOUND_CONFIRMED = 'INBOUND_CONFIRMED',
  OUTBOUND_CONFIRMED = 'OUTBOUND_CONFIRMED',
  TRIP_ROLLBACK = 'TRIP_ROLLBACK',
  DRAFT_CANCELLED = 'DRAFT_CANCELLED',
  ADMIN_OVERRIDE = 'ADMIN_OVERRIDE',
  ORDER_UPDATED = 'ORDER_UPDATED',
  ORDER_DELETED = 'ORDER_DELETED',
  DATA_RECONCILED = 'DATA_RECONCILED',
  TRANSACTION_DELETED = 'TRANSACTION_DELETED',
  TRANSACTION_RESTORED = 'TRANSACTION_RESTORED',
  TRANSACTION_UPDATED = 'TRANSACTION_UPDATED',
}

@Entity({
  name: 'order_activity_log',
})
export class OrderActivityLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int', nullable: true })
  orderId: number | null;

  @ManyToOne('OrderEntity', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'orderId' })
  order?: Relation<OrderEntity> | null;

  @Index()
  @Column({ type: String, length: 255, nullable: false })
  orderCode: string;

  @Index()
  @Column({ type: String, length: 50, nullable: false })
  action: OrderActivityAction | string;

  @Column({ type: 'int', nullable: false })
  actorUserId: number;

  @Column({ type: String, length: 500, nullable: true })
  actorEmail: string | null;

  @Column({ type: String, length: 255, nullable: true })
  actorRole: string | null;

  @Column({ type: 'int', nullable: false })
  hubId: number;

  @Column({ type: String, length: 1000, nullable: true })
  hubName: string | null;

  @Index()
  @Column({ type: String, length: 255, nullable: true })
  tripCode: string | null;

  @Column({ type: 'jsonb', nullable: true })
  oldValues: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  newValues: Record<string, any> | null;

  @Column({ type: 'int', nullable: true })
  quantity: number | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  bearerToken: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Index()
  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @BeforeInsert()
  @BeforeUpdate()
  sanitizeVarcharLengths() {
    if (this.orderCode && this.orderCode.length > 255) {
      this.orderCode = this.orderCode.slice(0, 255);
    }
    if (this.action && String(this.action).length > 50) {
      this.action = String(this.action).slice(0, 50);
    }
    if (this.actorEmail && this.actorEmail.length > 500) {
      this.actorEmail = this.actorEmail.slice(0, 500);
    }
    if (this.actorRole && this.actorRole.length > 255) {
      this.actorRole = this.actorRole.slice(0, 255);
    }
    if (this.hubName && this.hubName.length > 1000) {
      this.hubName = this.hubName.slice(0, 1000);
    }
    if (this.tripCode && this.tripCode.length > 255) {
      this.tripCode = this.tripCode.slice(0, 255);
    }
  }
}
