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
import { VehicleEntity } from '../../../../../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { DriverEntity } from '../../../../../drivers/infrastructure/persistence/relational/entities/driver.entity';

@Entity({
  name: 'trip',
})
export class TripEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: Number, nullable: false })
  orderId: number;

  @ManyToOne('OrderEntity', (order: OrderEntity) => order.trips, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order: Relation<OrderEntity>;

  @Column({ type: Number, nullable: true })
  vehicleId: number | null;

  @ManyToOne(() => VehicleEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'vehicleId' })
  vehicle: Relation<VehicleEntity> | null;

  @Column({ type: Number, nullable: true })
  driverId: number | null;

  @ManyToOne(() => DriverEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'driverId' })
  driver: Relation<DriverEntity> | null;

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
}
