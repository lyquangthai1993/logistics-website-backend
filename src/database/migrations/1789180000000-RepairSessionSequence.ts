import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repair serial sequences after data is restored or copied.
 *
 * A stale sequence makes the next insert reuse an existing primary key and
 * surface as an HTTP 500 from PostgreSQL. This covers session and operational
 * cron/report tables, not only the sequence that first exposed the issue.
 */
export class RepairSerialSequences1789180000000 implements MigrationInterface {
  name = 'RepairSerialSequences1789180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        sequence_record record;
        table_name text;
        max_id bigint;
      BEGIN
        FOR sequence_record IN
          SELECT sequence_class.relname AS sequence_name
          FROM pg_class sequence_class
          JOIN pg_namespace sequence_schema
            ON sequence_schema.oid = sequence_class.relnamespace
          WHERE sequence_class.relkind = 'S'
            AND sequence_schema.nspname = 'public'
            AND sequence_class.relname LIKE '%\\_id\\_seq' ESCAPE '\\'
        LOOP
          table_name := regexp_replace(
            sequence_record.sequence_name,
            '_id_seq$',
            ''
          );

          IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
            EXECUTE format(
              'SELECT MAX("id") FROM %I',
              table_name
            ) INTO max_id;

            PERFORM setval(
              format('public.%I', sequence_record.sequence_name),
              COALESCE(max_id, 1),
              max_id IS NOT NULL
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public down(): Promise<void> {
    // Sequence repair is intentionally irreversible and safe to re-run.
    return Promise.resolve();
  }
}
