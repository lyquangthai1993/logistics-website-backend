import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';
import { TripEntity } from '../../../../../trips/infrastructure/persistence/relational/entities/trip.entity';

@Entity({
  name: 'order',
})
export class OrderEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: String, unique: true, nullable: false })
  orderCode: string;

  @Index()
  @Column({ type: String, nullable: false, default: 'DRAFT' })
  status: string;

  @Column({ type: String, nullable: true })
  route: string | null;

  @Column({ type: String, nullable: true })
  originHub: string | null;

  @Column({ type: String, nullable: true })
  destinationHub: string | null;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalWeight: number;

  @Column({ type: 'float', nullable: false, default: 0 })
  totalVolume: number;

  @Column({ type: 'text', nullable: true })
  goodsDescription: string | null;

  @Column({ type: Boolean, nullable: false, default: false })
  isExternalVehicleNeeded: boolean;

  @Column({ type: 'text', nullable: true })
  externalNote: string | null;

  @Column({ type: Number, nullable: true })
  createdByUserId: number | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => TripEntity, (trip) => trip.order)
  trips: TripEntity[];
}
