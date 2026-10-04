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
import { OrderEntity } from '../../../../../orders/infrastructure/persistence/relational/entities/order.entity';
import { HubEntity } from '../../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Entity({
  name: 'trip',
})
export class TripEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: Number, nullable: false })
  orderId: number;

  @Index()
  @Column({ type: String, nullable: true })
  tripCode: string | null;

  @ManyToOne('OrderEntity', (order: OrderEntity) => order.trips, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order: Relation<OrderEntity>;

  @Column({ type: String, nullable: true })
  licensePlate: string | null;

  @Column({ type: String, nullable: true })
  driverName: string | null;

  @Index()
  @Column({ type: String, nullable: false, default: 'PENDING' })
  status: string;

  @Column({ type: String, nullable: true })
  pickupDate: string | null;

  @Column({ type: String, nullable: true })
  pickupTime: string | null;

  @Column({ type: String, nullable: true })
  estimatedDeliveryDate: string | null;

  @Column({ type: 'float', nullable: false, default: 0 })
  weightAllocated: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  volumeAllocated: number;

  @Column({ type: Number, nullable: false, default: 1 })
  sequenceNumber: number;

  @Column({ type: Number, nullable: true })
  assignedByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Index()
  @Column({ type: Number, nullable: true })
  originHubId: number | null;

  @ManyToOne(() => HubEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'originHubId' })
  originHub: Relation<HubEntity>;

  @Index()
  @Column({ type: Number, nullable: true })
  destinationHubId: number | null;

  @ManyToOne(() => HubEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'destinationHubId' })
  destinationHub: Relation<HubEntity>;

  @Index()
  @Column({ type: String, length: 20, nullable: false, default: 'INBOUND' })
  type: string;
}
