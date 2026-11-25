import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({ name: 'province_reference' })
export class ProvinceReferenceEntity extends EntityRelationalHelper {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: String, length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ type: String, length: 120 })
  normalizedName: string;

  @Index()
  @Column({ type: String, length: 20 })
  region: string;

  @Column('text', { array: true, default: '{}' })
  aliases: string[];
}
