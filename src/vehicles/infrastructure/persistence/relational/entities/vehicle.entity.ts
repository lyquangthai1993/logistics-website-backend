import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';

@Entity({
  name: 'vehicle',
})
export class VehicleEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: String, unique: true, nullable: false })
  licensePlate: string;

  @Column({ type: String, nullable: true })
  model: string | null;

  @Column({ type: String, nullable: false, default: 'CONTAINER_40FT' })
  type: string;

  @Column({ type: 'float', nullable: false, default: 25000 })
  maxWeight: number;

  @Column({ type: 'float', nullable: false, default: 65 })
  maxVolume: number;

  @Column({ type: String, nullable: true })
  currentHub: string | null;

  @Column({ type: String, nullable: false, default: 'AVAILABLE' })
  status: string;

  @Column({ type: Number, nullable: true })
  assignedDriverId: number | null;
}
