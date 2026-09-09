import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { AbstractBaseEntity } from '../../../../../utils/abstract-base.entity';

@Entity({
  name: 'order_code_counter',
})
@Unique(['hubId', 'operatorInitials', 'yearMonth'])
export class OrderCodeCounterEntity extends AbstractBaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int', nullable: false })
  hubId: number;

  @Index()
  @Column({ type: String, length: 10, nullable: false })
  operatorInitials: string;

  @Index()
  @Column({ type: String, length: 6, nullable: false })
  yearMonth: string; // e.g. "2609" (YYMM)

  @Column({ type: 'int', nullable: false, default: 0 })
  lastSequence: number;
}
