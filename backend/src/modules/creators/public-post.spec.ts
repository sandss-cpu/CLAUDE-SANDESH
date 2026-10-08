import { ContentStatus, ModerationStatus } from '@prisma/client';
import { isLive, livePost, publicPost } from './public-post';

const NOW = new Date('2026-10-08T06:00:00Z');
const post = (o: Partial<{ status: ContentStatus; moderation: ModerationStatus; visibleFrom: Date | null }> = {}) => ({
  status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED, visibleFrom: null, ...o,
});

describe('public posts', () => {
  it('a published, approved post with no delay is public', () => {
    expect(isLive(post(), NOW)).toBe(true);
  });

  it('a post still inside its safety delay is not, until the moment it ends', () => {
    expect(isLive(post({ visibleFrom: new Date('2026-10-08T09:00:00Z') }), NOW)).toBe(false);
    expect(isLive(post({ visibleFrom: NOW }), NOW)).toBe(true);
    expect(isLive(post({ visibleFrom: new Date('2026-10-07T09:00:00Z') }), NOW)).toBe(true);
  });

  it('a pending, refused or draft post is not public', () => {
    expect(isLive(post({ moderation: ModerationStatus.PENDING }), NOW)).toBe(false);
    expect(isLive(post({ moderation: ModerationStatus.REJECTED }), NOW)).toBe(false);
    expect(isLive(post({ status: ContentStatus.DRAFT }), NOW)).toBe(false);
  });

  it('the query says the same as the check', () => {
    expect(livePost(NOW)).toEqual({
      status: ContentStatus.PUBLISHED, moderation: ModerationStatus.APPROVED,
      AND: [{ OR: [{ visibleFrom: null }, { visibleFrom: { lte: NOW } }] }],
    });
  });

  it('drops the coordinates when the author hides their exact location, and keeps the place name', () => {
    const p = { id: 'p', locationName: 'Bandipur', latitude: 27.94, longitude: 84.41 };
    expect(publicPost(p, true)).toEqual({ id: 'p', locationName: 'Bandipur', latitude: null, longitude: null });
    expect(publicPost(p, false)).toBe(p);
  });
});
