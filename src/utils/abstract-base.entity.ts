import { CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from 'typeorm';
import { EntityRelationalHelper } from './relational-entity-helper';

/**
 * Abstract base entity for all business model tables.
 * Provides standard audit columns: createdAt, updatedAt, deletedAt.
 *
 * Usage: extend this class instead of EntityRelationalHelper for any
 * entity that requires audit timestamps (all non-lookup tables).
 *
 * Lookup tables (role, status) should still extend EntityRelationalHelper directly.
 */
export abstract class AbstractBaseEntity extends EntityRelationalHelper {
  @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt: Date | null;
}
