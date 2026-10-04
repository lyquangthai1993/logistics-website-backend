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

export enum TripStopStatus {
  /** Chờ xử lý */
  PENDING = 'PENDING',
  /** Đã xử lý */
  COMPLETED = 'COMPLETED',
}

export enum TripStopType {
  ORIGIN = 'ORIGIN',
  TRANSIT = 'TRANSIT',
  DESTINATION = 'DESTINATION',
}

/**
 * Per-hub processing state of a logical trip.
 * A logical trip is the group of `trip` allocation rows sharing the same `tripCode` (SD1, SD2...).
 * Each hub on the route sees its own status: PENDING (Chờ xử lý) / COMPLETED (Đã xử lý).
 */
@Entity({
  name: 'trip_stop',
})
@Unique('UQ_trip_stop_tripCode_hubId', ['tripCode', 'hubId'])
export class TripStopEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_trip_stop_tripCode')
  @Column({ type: String, length: 50, nullable: false })
  tripCode: string;

  @Index('IDX_trip_stop_hubId')
  @Column({ type: 'int', nullable: false })
  hubId: number;

  @ManyToOne(() => HubEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hubId', foreignKeyConstraintName: 'FK_trip_stop_hub' })
  hub: Relation<HubEntity>;

  @Column({ type: 'int', nullable: false, default: 1 })
  stopSequence: number;

  @Column({
    type: String,
    length: 20,
    nullable: false,
    default: TripStopType.TRANSIT,
  })
  stopType: string;

  @Index('IDX_trip_stop_status')
  @Column({
    type: String,
    length: 20,
    nullable: false,
    default: TripStopStatus.PENDING,
  })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  processedByUserId: number | null;
}
