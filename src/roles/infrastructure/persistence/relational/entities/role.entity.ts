import { Column, Entity, PrimaryColumn } from 'typeorm';
import { EntityRelationalHelper } from '../../../../../utils/relational-entity-helper';

@Entity({
  name: 'role',
})
export class RoleEntity extends EntityRelationalHelper {
  @PrimaryColumn()
  id: number;

  @Column()
  name?: string;

  @Column({ nullable: true, type: 'varchar', length: 100 })
  displayName?: string | null;

  @Column({ nullable: true, type: 'text' })
  description?: string | null;
}

