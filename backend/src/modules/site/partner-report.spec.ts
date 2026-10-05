import { checkMonth, partnerReport } from './partner-report';

describe('partner report', () => {
  it('counts each day of the month and works out the click-through rate', () => {
    const r = partnerReport('2026-09', [
      { day: '2026-09-01', key: 'impressions', n: 120 },
      { day: '2026-09-01', key: 'clicks', n: 6 },
      { day: '2026-09-30', key: 'impressions', n: 80 },
      { day: '2026-09-30', key: 'clicks', n: 4 },
      { day: '2026-09-15', key: 'enquiries', n: 2 },
      { day: '2026-09-15', key: 'couponsRedeemed', n: 1 },
      { day: '2026-10-01', key: 'clicks', n: 99 }, // next month: left out
    ]);
    expect(r.days).toHaveLength(30);
    expect(r.totals).toEqual({ impressions: 200, clicks: 10, profileViews: 0, contactTaps: 0, enquiries: 2, couponsIssued: 0, couponsRedeemed: 1 });
    // 10 clicks on 200 impressions: 5%.
    expect(r.ctr).toBe(0.05);
    expect(r.days[0]).toMatchObject({ day: '2026-09-01', impressions: 120, clicks: 6 });
  });
  it('has no rate without impressions', () => {
    expect(partnerReport('2026-02', []).ctr).toBeNull();
    expect(partnerReport('2026-02', []).days).toHaveLength(28);
  });
  it('accepts this month and earlier ones only', () => {
    expect(checkMonth(undefined, '2026-10-05')).toBe('2026-10');
    expect(checkMonth('2026-09', '2026-10-05')).toBe('2026-09');
    expect(() => checkMonth('2026-11', '2026-10-05')).toThrow();
    expect(() => checkMonth('2026-13', '2026-10-05')).toThrow();
  });
});
