/**
 * True only for a URL that /media/upload produced: the static base plus a
 * UUID filename. Anything else — a tracking pixel, or a path that walks out
 * of /static into the API — would be loaded by every reader's browser.
 */
export function isOwnMediaUrl(url: string | null | undefined, mediaBaseUrl: string): boolean {
  if (!url) return false;
  const base = mediaBaseUrl.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${base}/[0-9a-f-]{36}\\.(jpg|jpeg|png|webp|avif)$`).test(url);
}
