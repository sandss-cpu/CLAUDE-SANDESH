/**
 * HTML by tagged template: everything interpolated is escaped unless it is already
 * markup made here (`raw`, or another `html` result). The only way to put a string into
 * a page unescaped is to say so.
 */
export class Html {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

export const raw = (value: string) => new Html(value);

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function part(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Html(out);
}

/** Only http(s) links from the database reach an href or src; anything else becomes inert. */
export function safeUrl(url: string | null | undefined): string {
  const u = String(url ?? '').trim();
  return /^https?:\/\//i.test(u) || u.startsWith('/') ? u : '#';
}

/** JSON-LD inside a data block: "<" escaped so no value can close the script element. */
export function jsonLd(data: unknown): Html {
  return raw(`<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
}
