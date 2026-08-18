import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';
import { VehicleEntity } from '../../../../../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';

@Entity({
  name: 'hub',
})
export class HubEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: String, unique: true, nullable: false })
  code: string;

  @Column({ type: String, nullable: false })
  name: string;

  @Column({ type: String, nullable: false })
  city: string;

  @Column({ type: String, nullable: true })
  address: string | null;

  @Column({ type: String, nullable: true })
  contactPhone: string | null;

  @Column({ type: String, nullable: true })
  managerName: string | null;

  @Index()
  @Column({ type: Boolean, nullable: false, default: true })
  isActive: boolean;

  @OneToMany(() => VehicleEntity, (vehicle) => vehicle.hub)
  vehicles: Relation<VehicleEntity[]>;
}
