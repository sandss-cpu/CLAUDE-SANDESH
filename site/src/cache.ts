/**
 * Rendered pages in memory for a few minutes (PAGE_TTL), dropped at once when the API
 * says something changed (POST /_purge). Browsers and any CDN are told the same through
 * Cache-Control, with stale-while-revalidate so a slow database never shows as a slow page.
 */
interface Entry<T> { value: T; at: number }
const store = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 2000;

export async function cached<T>(key: string, ttlSeconds: number, make: () => Promise<T>): Promise<T> {
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlSeconds * 1000) return hit.value;
  const value = await make();
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string);
  store.set(key, { value, at: Date.now() });
  return value;
}

export function purge() { store.clear(); }
export const cacheSize = () => store.size;
