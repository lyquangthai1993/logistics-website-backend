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
}
