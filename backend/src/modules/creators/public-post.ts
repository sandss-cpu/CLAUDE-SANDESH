import { ContentStatus, ModerationStatus, Prisma } from '@prisma/client';

/**
 * A post is public once it is published, approved by moderation and past any safety delay
 * its traveller set (User.publishDelayHours → Post.visibleFrom). The feed always applied the
 * delay; creator profiles and journeys now do too, and the website's role checks the same.
 */
export function livePost(now: Date = new Date()): Prisma.PostWhereInput {
  return {
    status: ContentStatus.PUBLISHED,
    moderation: ModerationStatus.APPROVED,
    AND: [{ OR: [{ visibleFrom: null }, { visibleFrom: { lte: now } }] }],
  };
}

/** The same rule, for a post already loaded (a journey's entries). */
export function isLive(
  post: { status: ContentStatus; moderation: ModerationStatus; visibleFrom: Date | null },
  now: Date = new Date(),
): boolean {
  return post.status === ContentStatus.PUBLISHED && post.moderation === ModerationStatus.APPROVED
    && (!post.visibleFrom || post.visibleFrom <= now);
}

/** What a reader sees of a post: no coordinates when its author hides their exact location. */
export function publicPost<T extends { latitude?: number | null; longitude?: number | null }>(post: T, hideExactLocation: boolean): T {
  return hideExactLocation ? { ...post, latitude: null, longitude: null } : post;
}
