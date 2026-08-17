import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';

@Entity({
  name: 'driver',
})
export class DriverEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: String, nullable: false })
  fullName: string;

  @Column({ type: String, nullable: false })
  phone: string;

  @Column({ type: String, nullable: true })
  licenseNumber: string | null;

  @Column({ type: String, nullable: false, default: 'FC' })
  licenseClass: string;

  @Column({ type: Number, nullable: false, default: 5 })
  experienceYears: number;

  @Column({ type: String, nullable: false, default: 'AVAILABLE' })
  status: string;
}

