import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';
import { TripEntity } from '../../../../../trips/infrastructure/persistence/relational/entities/trip.entity';
import { HubEntity } from '../../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

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

  @Column({ type: 'int', nullable: true })
  totalQuantity: number | null;

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

  // ── Hub FK (Phase 1: nullable, backward-compat with VARCHAR originHub/destinationHub) ──

  @Column({ type: 'int', nullable: true })
  originHubId: number | null;

  @ManyToOne(() => HubEntity, { nullable: true, eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'originHubId' })
  originHubEntity: Relation<HubEntity> | null;

  @Column({ type: 'int', nullable: true })
  destinationHubId: number | null;

  @ManyToOne(() => HubEntity, { nullable: true, eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'destinationHubId' })
  destinationHubEntity: Relation<HubEntity> | null;

  @OneToMany('TripEntity', (trip: TripEntity) => trip.order)
  trips: Relation<TripEntity[]>;
}
