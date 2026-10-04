#!/usr/bin/env node
/**
 * Cross-references the API's routes with the paths the web pages call, for GAPS.md:
 * routes no page uses (an endpoint with no UI) and calls no route answers (a UI
 * calling something missing). Path-only, because the pages pass the HTTP method in
 * options that a regex cannot follow reliably; a route counts as used if any page
 * calls its path.
 *
 *   node scripts/api-coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, test, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, test, out);
    else if (test(name)) out.push(path);
  }
  return out;
}

const segments = (p) => p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

// ---- routes, from the controllers ----
const routes = [];
for (const file of walk(join(ROOT, 'backend/src'), (n) => n.endsWith('.controller.ts'))) {
  const src = readFileSync(file, 'utf8');
  const base = (src.match(/@Controller\(\s*'([^']*)'\s*\)/) || [, ''])[1];
  for (const m of src.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
    const path = `/${[base, m[2] || ''].filter(Boolean).join('/')}`;
    routes.push({ method: m[1].toUpperCase(), path, file: relative(ROOT, file) });
  }
}

// ---- calls, from the pages and scripts ----
const calls = new Map();
const pageFiles = walk(join(ROOT, 'web'), (n) => /\.(html|js)$/.test(n) && n !== 'sw.js');
for (const file of pageFiles) {
  const src = readFileSync(file, 'utf8');
  const found = [
    // ${…} blocks are stepped over whole: they hold calls like encodeURIComponent(id).
    ...src.matchAll(/\$\{API\}(\/(?:\$\{[^}]*\}|[^`'"\s$])*)/g),
    ...src.matchAll(/\b(?:api|authed|apiGet|apiPost)\(\s*[`'"](\/(?:\$\{[^}]*\}|[^`'"$])*)/g),
  ];
  for (const m of found) {
    let path = m[1].split('?')[0].replace(/\$\{[^}]*\}/g, ':p');
    if (!path || path === '/' || path.startsWith('/${') || path === ':p') continue;
    // `${API}${path}` style helpers leave nothing useful behind.
    if (path.includes('${')) continue;
    const key = path.replace(/\/+$/, '');
    if (!calls.has(key)) calls.set(key, new Set());
    calls.get(key).add(relative(ROOT, file));
  }
}

function matches(routePath, callPath) {
  const r = segments(routePath);
  const c = segments(callPath);
  if (r.length !== c.length) return false;
  return r.every((seg, i) => seg.startsWith(':') || c[i] === ':p' || c[i].includes(':p') || seg === c[i]);
}

const unusedRoutes = routes.filter((r) => ![...calls.keys()].some((c) => matches(r.path, c)));
const missingRoutes = [...calls.entries()].filter(([c]) => !routes.some((r) => matches(r.path, c)));

console.log(`${routes.length} routes, ${calls.size} distinct paths called from ${pageFiles.length} files\n`);
console.log(`Routes no page calls (${unusedRoutes.length}):`);
for (const r of unusedRoutes) console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(48)} ${r.file}`);
console.log(`\nPaths called with no matching route (${missingRoutes.length}):`);
for (const [p, files] of missingRoutes) console.log(`  ${p.padEnd(55)} ${[...files].join(', ')}`);
