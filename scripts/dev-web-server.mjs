#!/usr/bin/env node
/**
 * Local web server for web/, with the same rewrites render.yaml gives the hosted site.
 *
 * A printed sticker opens /b/<code> (and older ones /r/<code>), which is not a file:
 * both must answer with the reader, keeping the path so the reader can read the code
 * from it. python -m http.server cannot rewrite, so every sticker link 404'd locally.
 *
 *   node scripts/dev-web-server.mjs            # http://localhost:5173
 *   PORT=5180 node scripts/dev-web-server.mjs
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webHeaders } from './web-headers.mjs';

const ROOT = resolve(fileURLToPath(new URL('../web', import.meta.url)));
const PORT = Number(process.env.PORT || 5173);
/** The API the pages call locally; allowed by the same strict policy the hosted site sends. */
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';

/** Paths answered by another file, as the hosted static site's `routes:` rewrites do. */
const REWRITES = [
  [/^\/b\/[^/]+\/?$/, '/index.html'],
  [/^\/r\/[^/]+\/?$/, '/index.html'],
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Text compresses to about a third; the hosted static site compresses it too, so measure the same. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.webmanifest']);

function target(pathname) {
  for (const [pattern, file] of REWRITES) if (pattern.test(pathname)) return file;
  return pathname.endsWith('/') ? `${pathname}index.html` : pathname;
}

createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const file = normalize(join(ROOT, target(pathname)));
  // normalize() resolves "..", so anything outside web/ is a traversal attempt.
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const ext = extname(file).toLowerCase();
    const gzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : { 'Content-Length': info.size }),
      // Development: always revalidate, so an edit shows on the next reload.
      'Cache-Control': 'no-cache',
      ...webHeaders(pathname, { api: API_ORIGIN, production: false }),
    });
    if (req.method === 'HEAD') return res.end();
    const body = createReadStream(file);
    (gzip ? body.pipe(createGzip()) : body).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
  console.log(`${req.method} ${pathname} ${res.statusCode}`);
}).listen(PORT, () => {
  console.log(`Batoma web on http://localhost:${PORT}  (serving ${ROOT})`);
});
