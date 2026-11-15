import { BadRequestException } from '@nestjs/common';
import { resolveRegionalDispatchSyncDate } from './admin-reports.service';

describe('resolveRegionalDispatchSyncDate', () => {
  const today = '2026-11-15';

  it('should default manual sync to the current operational date', () => {
    expect(resolveRegionalDispatchSyncDate(undefined, today)).toBe(today);
    expect(resolveRegionalDispatchSyncDate('', today)).toBe(today);
  });

  it('should keep a historical date when explicitly requested', () => {
    expect(resolveRegionalDispatchSyncDate('2026-11-14', today)).toBe(
      '2026-11-14',
    );
  });

  it('should reject future snapshot dates instead of writing current data into them', () => {
    expect(() => resolveRegionalDispatchSyncDate('2026-12-31', today)).toThrow(
      BadRequestException,
    );
  });
});
