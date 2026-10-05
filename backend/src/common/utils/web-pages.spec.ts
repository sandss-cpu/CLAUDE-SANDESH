import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * The static pages in web/ have no build step, so the rules they live by are checked
 * here: nothing loaded from another origin, no inline code on the pages already moved
 * to delegated actions, and generated copies that have not drifted from their source.
 */
const WEB = join(__dirname, '../../../../web');
const read = (file: string) => readFileSync(join(WEB, file), 'utf8');
const pages = readdirSync(WEB).filter((f) => f.endsWith('.html'));

/** Pages whose code lives in web/js and runs through actions.js; they must stay that way. */
/** Every page: none carries inline script or handlers any more (known gap 7, closed in step 10). */
const NO_INLINE_CODE = pages;

describe('web pages', () => {
  it.each(pages)('%s loads nothing from another origin', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/<script[^>]+src="(https?:)?\/\//);
    expect(html).not.toMatch(/<link[^>]+href="(https?:)?\/\/[^"]+"[^>]*rel="stylesheet"|<link[^>]+rel="stylesheet"[^>]+href="(https?:)?\/\//);
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it.each(NO_INLINE_CODE)('%s has no inline scripts or handlers', (page) => {
    const html = read(page);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("keeps the reader's inline font faces identical to css/fonts.css", () => {
    // scripts/sync-web-libs.mjs copies them; run it after changing fonts.css.
    const faces = (text: string) => text.split('\n').filter((l) => l.startsWith('@font-face')).join('\n');
    const inline = read('index.html').split('/* fonts.css:start')[1]?.split('/* fonts.css:end */')[0] ?? '';
    expect(faces(inline)).toBe(faces(read('css/fonts.css')));
    for (const url of read('css/fonts.css').match(/\/fonts\/[\w.-]+\.woff2/g) ?? []) {
      expect(existsSync(join(WEB, url))).toBe(true);
    }
  });

  it('pre-caches only files that exist', () => {
    const sw = read('sw.js');
    const shell = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];', sw.indexOf('const SHELL = [')));
    const paths = shell.match(/'\/[^']*'/g)!.map((p) => p.slice(1, -1));
    expect(paths.length).toBeGreaterThan(20);
    for (const path of paths) {
      const file = path === '/' ? 'index.html' : path.slice(1);
      expect([path, existsSync(join(WEB, file))]).toEqual([path, true]);
    }
  });
});
