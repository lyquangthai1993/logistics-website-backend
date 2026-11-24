import { describe, expect, it, jest } from '@jest/globals';
import { RepairSerialSequences1789180000000 } from './1789180000000-RepairSessionSequence';

describe('RepairSerialSequences1789180000000', () => {
  it('should align public serial sequences with persisted table ids', async () => {
    let sql = '';
    const query = jest.fn((value: string) => {
      sql = value;
    });
    const migration = new RepairSerialSequences1789180000000();

    await migration.up({ query } as never);

    expect(query).toHaveBeenCalledTimes(1);
    expect(sql).toContain('MAX("id")');
    expect(sql).toContain('setval(');
    expect(sql).toContain("LIKE '%\\_id\\_seq'");
    expect(sql).toContain("'_id_seq$'");
  });
});
