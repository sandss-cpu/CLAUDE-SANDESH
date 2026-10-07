import { config } from './config';
import type { ArticleCard, LiveAd } from './data';
import type { SiteEventIn } from './events';
import { CATEGORY_LABEL, dayAd, dayBoth, STOP_LABEL } from './format';
import { esc, html, Html, raw, safeUrl } from './html';
import { sponsoredLabel } from './layout';

/** What a page hands back: its HTML, and what it showed, for the partner reports. */
export interface Rendered {
  html: string;
  events: SiteEventIn[];
  status?: number;
}

/** Uploads live on the API; anything else must be an http(s) or site-relative link. */
const apiOrigin = (() => { try { return new URL(config.apiUrl).origin; } catch { return ''; } })();
export const mediaUrl = (u: string | null | undefined) => (u && u.startsWith('/uploads/') ? `${apiOrigin}${u}` : safeUrl(u));
export const mediaOrigin = apiOrigin;

/** A stable colour for a card with no photo, picked from the section or name. */
export function tone(key: string | null | undefined): string {
  let h = 0;
  for (const c of String(key ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `tone-${h % 6}`;
}

/**
 * Uploads are stored at 480, 960 and up to 1600 pixels wide, named `<id>-<width>.webp`
 * (backend common/media/images.ts), so the sizes can be offered from the address alone.
 */
const WIDTHS = [480, 960, 1600];
export function srcset(url: string): string | null {
  const m = /^(.*)-(\d{2,4})\.webp$/.exec(url);
  if (!m) return null;
  const top = Number(m[2]);
  return [...WIDTHS.filter((w) => w < top), top].map((w) => `${m[1]}-${w}.webp ${w}w`).join(', ');
}
export function img(url: string, alt: string, opts: { sizes: string; width: number; height: number; lazy?: boolean }): Html {
  const src = mediaUrl(url);
  const set = srcset(src);
  return html`<img src="${src}"${set ? raw(` srcset="${esc(set)}" sizes="${esc(opts.sizes)}"`) : ''} alt="${alt}"${opts.lazy === false ? '' : raw(' loading="lazy"')} decoding="async" width="${opts.width}" height="${opts.height}">`;
}

function picture(url: string | null | undefined, alt: string, key: string, label?: string): Html {
  if (url) return html`<div class="pic">${img(url, alt, { sizes: '(min-width: 980px) 360px, (min-width: 640px) 50vw, 100vw', width: 640, height: 400 })}</div>`;
  return html`<div class="pic ph ${tone(key)}" aria-hidden="true"><span>${label ?? ''}</span></div>`;
}

export function articleCard(a: ArticleCard, opts: { lead?: boolean } = {}): Html {
  return html`<article class="card${opts.lead ? ' card-lead' : ''}">
  <a class="card-link" href="/stories/${a.slug}">
    ${picture(a.coverImageUrl, '', a.category?.slug ?? a.slug, a.category?.name)}
    <div class="card-body">
      <p class="kicker">${a.category?.name ?? 'Story'}${a.isSponsored ? raw(` ${sponsoredLabel(a.sponsor?.name).value}`) : ''}</p>
      <h3>${a.title}</h3>
      ${a.summary ? html`<p class="dim">${a.summary}</p>` : ''}
      <p class="meta">${a.readMinutes} min read${a.audioUrl ? ' · Listen' : ''}${a.publishedAt ? html` · <time datetime="${a.publishedAt.toISOString()}">${dayAd(a.publishedAt)}</time>` : ''}</p>
    </div>
  </a>
</article>`;
}

/** Sponsored stories show their partner; the event ties the impression to them. */
export function articleEvents(list: ArticleCard[], where: string): SiteEventIn[] {
  return list.filter((a) => a.isSponsored).map((a) => ({ type: 'IMPRESSION' as const, path: where, target: 'sponsored-story', articleId: a.id, businessId: a.sponsor?.id ?? null }));
}

type GuideCard = { slug: string; kind: string; title: string; summary: string | null; coverImageUrl: string | null; dayCount: number | null;
  route: { startPlace: string; endPlace: string; distanceKm: number | null; typicalHours: number | null } | null;
  destination: { slug: string; name: string } | null; _count: { stops: number } };

export function guideCard(g: GuideCard): Html {
  const facts = g.route
    ? [g.route.distanceKm ? `${g.route.distanceKm} km` : '', g.route.typicalHours ? `about ${g.route.typicalHours} hours` : '', `${g._count.stops} stops`]
    : [g.dayCount ? `${g.dayCount} days` : '', `${g._count.stops} places`];
  return html`<article class="card">
  <a class="card-link" href="/trips/${g.slug}">
    ${picture(g.coverImageUrl, '', g.slug, g.route ? `${g.route.startPlace} → ${g.route.endPlace}` : g.destination?.name)}
    <div class="card-body">
      <p class="kicker">${g.kind === 'ROUTE' ? 'Road guide' : 'Trip idea'}</p>
      <h3>${g.title}</h3>
      ${g.summary ? html`<p class="dim">${g.summary}</p>` : ''}
      <p class="meta">${facts.filter(Boolean).join(' · ')}</p>
    </div>
  </a>
</article>`;
}

type PartnerCard = { id: string; slug: string; name: string; category: string; description: string | null; district: string | null;
  priceRange: string | null; tier: string; destination: { slug: string; name: string } | null; photos: Array<{ url: string; caption: string | null }> };

export const isFeaturedTier = (tier: string) => tier === 'FEATURED' || tier === 'PREMIUM';

export function partnerCard(p: PartnerCard): Html {
  return html`<article class="card">
  <a class="card-link" href="/partners/${p.slug}">
    ${picture(p.photos[0]?.url, p.photos[0]?.caption ?? '', p.category, CATEGORY_LABEL[p.category])}
    <div class="card-body">
      <p class="kicker">${CATEGORY_LABEL[p.category] ?? 'Partner'}${isFeaturedTier(p.tier) ? raw(' <span class="badge">Featured partner</span>') : ''}</p>
      <h3>${p.name}</h3>
      ${p.description ? html`<p class="dim">${p.description.length > 140 ? `${p.description.slice(0, 139)}…` : p.description}</p>` : ''}
      <p class="meta">${[p.destination?.name ?? p.district, p.priceRange].filter(Boolean).join(' · ')}<span class="verified">Verified</span></p>
    </div>
  </a>
</article>`;
}

export const partnerEvents = (list: Array<{ id: string }>, where: string, target = 'card'): SiteEventIn[] =>
  list.map((p) => ({ type: 'IMPRESSION' as const, path: where, target, businessId: p.id }));

type Deal = { id: string; title: string; description: string | null; discountLabel: string; validTo: Date; business: { slug: string; name: string; district?: string | null } };

export function dealCard(d: Deal): Html {
  return html`<article class="deal">
  <p class="deal-off">${d.discountLabel}</p>
  <h3>${d.title}</h3>
  ${d.description ? html`<p class="dim">${d.description}</p>` : ''}
  <p class="meta">At <a href="/partners/${d.business.slug}">${d.business.name}</a>${d.business.district ? `, ${d.business.district}` : ''} · until ${dayBoth(d.validTo)}</p>
  <p class="small">Claim it in the <a href="${config.appUrl}/">Batoma app</a> and show it when you pay.</p>
</article>`;
}

const SLOT_LABEL: Record<string, string> = {
  WEB_HOME_HERO: 'Partner spotlight', WEB_SECTION_SPONSOR: 'Section partner', WEB_SPONSORED_ARTICLE: 'From our partners',
  WEB_DESTINATION_SPONSOR: 'Place partner', WEB_DEALS: 'Featured deal', WEB_NEWSLETTER: 'Newsletter partner',
};

/** A paid slot, always labelled; its link goes through /go/ so the click is counted once. */
export function adSlot(ad: LiveAd | undefined, path: string): { html: Html; events: SiteEventIn[] } {
  if (!ad) return { html: raw(''), events: [] };
  const wide = ad.placement === 'WEB_HOME_HERO';
  return {
    html: html`<aside class="ad${wide ? ' ad-wide' : ''}" aria-label="${SLOT_LABEL[ad.placement] ?? 'Sponsored'}">
  <p class="ad-head"><span class="ad-slot">${SLOT_LABEL[ad.placement] ?? 'Sponsored'}</span>${sponsoredLabel(ad.advertiserName)}</p>
  <a class="ad-link" href="/go/ad/${ad.id}" rel="sponsored noopener">
    ${img(ad.imageUrl, '', { sizes: '(min-width: 760px) 640px, 100vw', width: 640, height: 320 })}
    <span class="ad-text"><strong>${ad.title}</strong>${ad.tagline ? html`<span>${ad.tagline}</span>` : ''}</span>
  </a>
</aside>`,
    events: [{ type: 'IMPRESSION', path, target: `ad:${ad.placement}`, adId: ad.id, businessId: ad.businessId }],
  };
}

export function stopRow(s: { kind: string; name: string; description: string | null; distanceFromStartKm: number | null; minutesFromStart: number | null;
  priceFromNpr: number | null; openingHours: string | null; tip: string | null; isHighlight: boolean; business: { slug: string; name: string } | null }, km: number | null): Html {
  const h = Math.floor((s.minutesFromStart ?? 0) / 60);
  const m = (s.minutesFromStart ?? 0) % 60;
  const time = s.minutesFromStart != null && s.minutesFromStart > 0 ? `about ${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''} in` : '';
  return html`<li class="road-stop${s.isHighlight ? ' hl' : ''}">
  <p class="kicker">${STOP_LABEL[s.kind] ?? 'Stop'}${km != null ? ` · km ${km}` : ''}${time ? ` · ${time}` : ''}</p>
  <h3>${s.business ? html`<a href="/partners/${s.business.slug}">${s.name}</a>` : s.name}</h3>
  ${s.description ? html`<p>${s.description}</p>` : ''}
  ${s.tip ? html`<p class="tip"><strong>Tip:</strong> ${s.tip}</p>` : ''}
  ${s.priceFromNpr || s.openingHours ? html`<p class="meta">${[s.priceFromNpr ? `From NPR ${s.priceFromNpr.toLocaleString('en-IN')}` : '', s.openingHours ? `Open ${s.openingHours}` : ''].filter(Boolean).join(' · ')}</p>` : ''}
</li>`;
}

// ================= forms =================

export interface FormState {
  values?: Record<string, string>;
  error?: string;
}

/** The hidden field people never see; bots fill it. Plus the time token stamped at serve time. */
export const formGuards = () => raw(`<div class="hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="t" value="__FORM_TOKEN__">`);

export function field(name: string, label: string, state: FormState | undefined, opts: { type?: string; textarea?: boolean; rows?: number; required?: boolean; max?: number; autocomplete?: string; hint?: string } = {}): Html {
  const v = state?.values?.[name] ?? '';
  const id = `f-${name}`;
  const common = html`id="${id}" name="${name}"${opts.required ? raw(' required') : ''}${opts.max ? raw(` maxlength="${opts.max}"`) : ''}${opts.autocomplete ? raw(` autocomplete="${esc(opts.autocomplete)}"`) : ''}${opts.hint ? raw(` aria-describedby="${id}-hint"`) : ''}`;
  return html`<div class="field">
  <label for="${id}">${label}</label>
  ${opts.hint ? html`<p class="hint" id="${id}-hint">${opts.hint}</p>` : ''}
  ${opts.textarea ? html`<textarea ${common} rows="${opts.rows ?? 5}">${v}</textarea>` : html`<input ${common} type="${opts.type ?? 'text'}" value="${v}">`}
</div>`;
}

export const formError = (state?: FormState) => (state?.error ? html`<p class="form-error" role="alert">${state.error}</p>` : '');

export const sentNote = (text: string) => html`<div class="sent" role="status"><strong>Thank you.</strong> ${text}</div>`;

export function newsletterForm(source: string, state?: FormState, sent?: boolean): Html {
  if (sent) return html`<div class="newsletter">${sentNote('Check your inbox and confirm, and the next issue will come to you.')}</div>`;
  return html`<form class="newsletter" method="post" action="/newsletter">
  <h2>The Batoma letter</h2>
  <p>New stories, road guides and partner deals, about twice a month. Confirm by email; leave with one click.</p>
  ${formError(state)}
  <div class="row">
    <label class="sr" for="nl-email-${source}">Email address</label>
    <input id="nl-email-${source}" name="email" type="email" required autocomplete="email" placeholder="you@example.com" value="${state?.values?.email ?? ''}">
    <input type="hidden" name="source" value="${source}">
    <button class="btn" type="submit">Subscribe</button>
  </div>
  ${formGuards()}
</form>`;
}

export function pager(base: string, page: number, pages: number): Html {
  if (pages <= 1) return raw('');
  const link = (p: number) => (p === 1 ? base : `${base}${base.includes('?') ? '&' : '?'}page=${p}`);
  return html`<nav class="pager" aria-label="Pages">
  ${page > 1 ? html`<a class="btn btn-ghost" href="${link(page - 1)}" rel="prev">← Newer</a>` : ''}
  <span>Page ${page} of ${pages}</span>
  ${page < pages ? html`<a class="btn btn-ghost" href="${link(page + 1)}" rel="next">Older →</a>` : ''}
</nav>`;
}

export const crumbs = (items: Array<[string, string]>) => html`<nav class="crumbs" aria-label="You are here">${items.map(([href, label], i) =>
  i === items.length - 1 ? html`<span aria-current="page">${label}</span>` : html`<a href="${href}">${label}</a><span aria-hidden="true">›</span>`)}</nav>`;
