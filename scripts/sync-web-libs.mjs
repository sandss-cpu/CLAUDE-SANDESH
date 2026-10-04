#!/usr/bin/env node
/**
 * Builds the browser copies of small, dependency-free backend utilities, so the server
 * and the pages share one implementation and one test suite.
 *
 *   node scripts/sync-web-libs.mjs
 *
 * Each source is transpiled with the backend's TypeScript and wrapped so the page gets a
 * global (window.BsDate). The copy records the source's hash; a unit test fails if
 * the source changes without this being run again.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'backend/package.json'));
const ts = require('typescript');

const LIBS = [
  { source: 'backend/src/common/utils/bs-date.ts', target: 'web/js/lib/bs-date.js', global: 'BsDate' },
];

for (const lib of LIBS) {
  const source = readFileSync(join(ROOT, lib.source), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, removeComments: false },
  });
  const wrapped = `/* Generated from ${lib.source} by scripts/sync-web-libs.mjs (source sha256 ${hash}).
   Do not edit: change the source, run the script, and commit both. */
(function (root) {
  var module = { exports: {} };
  var exports = module.exports;
${outputText.replace(/^/gm, '  ')}
  root.${lib.global} = module.exports;
})(typeof self !== 'undefined' ? self : this);
`;
  const target = join(ROOT, lib.target);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, wrapped);
  console.log(`${lib.target}  ←  ${lib.source}`);
}
