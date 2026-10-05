import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';
import { esc, html, Html, jsonLd, raw } from './html';

/** site.css is linked by the hash of its content, so browsers can keep it until it changes. */
const cssVersion = (() => {
  try { return createHash('sha256').update(readFileSync(join(__dirname, '../../public/css/site.css'))).digest('hex').slice(0, 10); } catch { return 'dev'; }
})();

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  type?: 'website' | 'article';
  ld?: unknown[];
  noindex?: boolean;
  /** Extra <head> lines made here, such as article dates. */
  head?: Html;
}

const NAV: Array<[string, string]> = [
  ['/magazine', 'Magazine'], ['/trips', 'Trips'], ['/partners', 'Partners & deals'], ['/write', 'Write a trip'], ['/advertise', 'Advertise'],
];

export const absolute = (path: string) => (/^https?:\/\//.test(path) ? path : `${config.siteUrl}${path}`);

/** One shell for every page: real HTML, no script, and everything a search engine or a share card needs. */
export function page(meta: PageMeta, body: Html): string {
  const title = meta.title === 'Batoma' ? 'Batoma: Nepal travel magazine' : `${meta.title} · Batoma`;
  const image = absolute(meta.image || '/icons/icon-512.png');
  const current = (href: string) => meta.path === href || meta.path.startsWith(`${href}/`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${esc(absolute(meta.path))}">
${meta.noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="Batoma">
<meta property="og:type" content="${meta.type ?? 'website'}">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${esc(absolute(meta.path))}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#5B3FA8">
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="preload" href="/fonts/mukta-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css?v=${cssVersion}">
${meta.head?.value ?? ''}
${(meta.ld ?? []).map((d) => jsonLd(d).value).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="top">
  <div class="top-in">
    <a class="logo" href="/" aria-label="Batoma home">Batoma<span>Nepal travel magazine</span></a>
    <details class="menu">
      <summary aria-label="Menu">Menu</summary>
      <nav aria-label="Main">${NAV.map(([href, label]) => `<a href="${href}"${current(href) ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>
    </details>
    <nav class="wide-nav" aria-label="Main">${NAV.map(([href, label]) => `<a href="${href}"${current(href) ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</nav>
  </div>
  <div class="flags" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
</header>
<main id="main">
${body.value}
</main>
<footer class="foot">
  <div class="foot-in">
    <div><strong class="logo">Batoma</strong><p>Stories, road guides and the people worth stopping for, from Kathmandu to the far west.</p></div>
    <nav aria-label="About Batoma"><a href="/about">About</a><a href="/contact">Contact</a><a href="/advertise">Advertise</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
  </div>
  <p class="small">© ${new Date().getFullYear()} Batoma. No tracking cookies on this site.</p>
</footer>
</body>
</html>`;
}

/** A labelled band for anything paid for, so a reader always knows. */
export const sponsoredLabel = (who: string | null | undefined) => html`<span class="sponsored">Sponsored${who ? raw(` · ${esc(who)}`) : ''}</span>`;
