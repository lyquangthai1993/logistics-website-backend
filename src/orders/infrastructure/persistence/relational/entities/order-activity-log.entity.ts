import {
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
  @Column({ type: String, length: 100, nullable: false })
  orderCode: string;

  @Index()
  @Column({ type: String, length: 50, nullable: false })
  action: OrderActivityAction | string;

  @Column({ type: 'int', nullable: false })
  actorUserId: number;

  @Column({ type: String, length: 255, nullable: true })
  actorEmail: string | null;

  @Column({ type: String, length: 100, nullable: true })
  actorRole: string | null;

  @Column({ type: 'int', nullable: false })
  hubId: number;

  @Column({ type: String, length: 255, nullable: true })
  hubName: string | null;

  @Index()
  @Column({ type: String, length: 100, nullable: true })
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
}
