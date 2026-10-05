/**
 * Offline-first service worker.
 *
 * The whole product assumes the reader loses signal on the highway, so the
 * shell and the route content pack are cached at the bus park while a
 * connection still exists. Nothing here should ever require the network.
 */
const SHELL_CACHE = 'bato-shell-v14';
const CONTENT_CACHE = 'bato-content-v1';
const IMAGE_CACHE = 'bato-images-v1';

const SHELL = [
  '/', '/index.html', '/manifest.json', '/config.js', '/js/boot.js', '/css/fonts.css', '/js/actions.js', '/js/reader.js', '/js/admin.js', '/js/admin-programming.js', '/js/bus.js', '/js/rating.js', '/scan.html', '/js/scan.js',
  '/login.html', '/admin.html', '/bus.html',
  '/creator.html', '/owner.html', '/owner-core.js', '/owner-screens.js', '/owner-bus.js', '/owner-more.js', '/owner-actions.js', '/owner-trips.js', '/owner-crew.js', '/owner-income.js', '/js/lib/bs-date.js',
  // The Latin faces every page uses; Devanagari and extended Latin are cached the first time a page needs them.
  '/fonts/mukta-latin-400-normal.woff2', '/fonts/mukta-latin-600-normal.woff2', '/fonts/mukta-latin-700-normal.woff2',
  '/fonts/fraunces-latin-600-normal.woff2',
];

/**
 * How long a page or script waits for the network before the cached copy is
 * served. On a 2G or 3G signal a round trip alone can take two seconds, so
 * waiting the full three only delays a page this phone already holds; the
 * network answer still refreshes the cache for next time.
 */
function shellWait() {
  const type = self.navigator?.connection?.effectiveType;
  if (type === 'slow-2g' || type === '2g') return 800;
  if (type === '3g') return 1500;
  return 3000;
}

/**
 * Pages and scripts: network first, so a deploy reaches readers on their next
 * visit. If the network has not answered within `ms` (a bus in a valley), the
 * cached copy is served instead, so reading never waits on signal.
 */
function networkThenCache(request, ms = shellWait()) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const cached = () => caches.match(request).then((hit) => hit || caches.match('/index.html'));

    const timer = setTimeout(() => cached().then(done), ms);
    fetch(request)
      .then((res) => {
        if (res.ok && new URL(request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
        }
        clearTimeout(timer);
        done(res);
      })
      .catch(() => cached().then((hit) => { clearTimeout(timer); done(hit || Response.error()); }));
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, CONTENT_CACHE, IMAGE_CACHE].includes(k))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

/** Fetches and stores each address, counting only real successes. */
async function cacheAll(urls) {
  const cache = await caches.open(CONTENT_CACHE);
  let cached = 0;
  const failed = [];
  for (const url of urls) {
    try {
      // cors mode so a real response is stored, not an opaque one that
      // cannot be read back and cannot be counted.
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache.put(url, res.clone());
      cached += 1;
    } catch (e) {
      failed.push({ url, reason: String(e && e.message ? e.message : e) });
    }
  }
  return { cache, cached, failed };
}

/**
 * Pre-cache the offline pack the API hands back on a QR scan (CACHE_PACK), or
 * a few addresses the reader asked to keep, such as a saved story (CACHE_URLS).
 *
 * The API sends absolute URLs because a relative path would resolve against
 * this page's origin rather than the API's, and every fetch would 404 into a
 * silently discarded error. Failures are counted and reported so the reader
 * is never told they have offline content when they do not.
 */
self.addEventListener('message', (event) => {
  const type = event.data?.type;
  if (type !== 'CACHE_PACK' && type !== 'CACHE_URLS') return;
  const urls = (event.data.urls || []).filter(Boolean);

  event.waitUntil((async () => {
    const { cache, cached, failed } = await cacheAll(urls);
    if (type === 'CACHE_URLS') {
      event.source?.postMessage({ type: 'URLS_CACHED', id: event.data.id, cached, failed: failed.length });
      return;
    }
    // Report what is genuinely on disk, not what we were asked to fetch.
    const verified = (await cache.keys()).length;
    event.source?.postMessage({
      type: 'PACK_CACHED',
      cached, verified, failed: failed.length, total: urls.length,
      firstFailure: failed[0] || null,
    });
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Fonts never change under the same name: cache first, and keep them with the shell.
  if (request.destination === 'font' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
      ),
    );
    return;
  }

  // Images: cache first — they are the bulk of the payload.
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(IMAGE_CACHE).then((c) => c.put(request, copy));
          return res;
        }).catch(() => hit),
      ),
    );
    return;
  }

  // API: network first, fall back to whatever was cached at the bus park.
  // pathname works for cross-origin API hosts too, since request.url is absolute.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CONTENT_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Shell. Cache-first here meant a deployed update never reached anyone
  // who had visited before.
  event.respondWith(networkThenCache(request));
});
