import { retentionCutoff } from './retention.service';

describe('retentionCutoff', () => {
  it('is midnight in Kathmandu, 13 months back', () => {
    // 5 Oct 2026, 16:00 in Kathmandu → 5 Sep 2025, 00:00 in Kathmandu = 4 Sep 2025, 18:15 UTC.
    expect(retentionCutoff(new Date('2026-10-05T10:15:00Z')).toISOString()).toBe('2025-09-04T18:15:00.000Z');
  });
  it('uses the Kathmandu date, not the UTC one, just after midnight in Nepal', () => {
    // 00:30 on 1 Nov 2026 in Kathmandu is still 31 Oct in UTC.
    expect(retentionCutoff(new Date('2026-10-31T18:45:00Z')).toISOString()).toBe('2025-09-30T18:15:00.000Z');
  });
});
