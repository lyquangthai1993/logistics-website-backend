/**
 * Date Range Guard Utility:
 * Prevents heavy full-table scans across years by capping date range span.
 * If range exceeds maxSpanDays (default 90 days), clamps fromDate to (toDate - maxSpanDays).
 * If neither is provided and defaultPastDays is specified, defaults to the past N days.
 */
export function sanitizeDateRangeGuard(
  query?: { fromDate?: string; toDate?: string },
  options: { defaultPastDays?: number; maxSpanDays?: number } = {},
): { fromDate?: string; toDate?: string } {
  const maxSpanDays = options.maxSpanDays ?? 90;
  let fromStr = query?.fromDate?.trim();
  let toStr = query?.toDate?.trim();

  if (!fromStr && !toStr && options.defaultPastDays) {
    const now = new Date();
    const past = new Date(
      now.getTime() - options.defaultPastDays * 24 * 60 * 60 * 1000,
    );
    return {
      fromDate: past.toISOString().split('T')[0],
      toDate: now.toISOString().split('T')[0],
    };
  }

  if (fromStr && toStr) {
    const fromTime = new Date(`${fromStr}T00:00:00`).getTime();
    const toTime = new Date(`${toStr}T23:59:59.999`).getTime();
    if (!isNaN(fromTime) && !isNaN(toTime)) {
      const diffDays = (toTime - fromTime) / (24 * 60 * 60 * 1000);
      if (diffDays > maxSpanDays) {
        const clampedFrom = new Date(
          toTime - maxSpanDays * 24 * 60 * 60 * 1000,
        );
        fromStr = clampedFrom.toISOString().split('T')[0];
      }
    }
  } else if (fromStr && !toStr) {
    const fromTime = new Date(`${fromStr}T00:00:00`).getTime();
    if (!isNaN(fromTime)) {
      const clampedTo = new Date(fromTime + maxSpanDays * 24 * 60 * 60 * 1000);
      toStr = clampedTo.toISOString().split('T')[0];
    }
  } else if (!fromStr && toStr) {
    const toTime = new Date(`${toStr}T23:59:59.999`).getTime();
    if (!isNaN(toTime)) {
      const clampedFrom = new Date(toTime - maxSpanDays * 24 * 60 * 60 * 1000);
      fromStr = clampedFrom.toISOString().split('T')[0];
    }
  }

  return { fromDate: fromStr || undefined, toDate: toStr || undefined };
}
