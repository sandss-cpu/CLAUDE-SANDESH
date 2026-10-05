import { config } from '../config';
import * as data from '../data';
import { html } from '../html';
import { page } from '../layout';
import { dealPartners } from './partners';
import { adSlot, articleCard, articleEvents, dealCard, guideCard, partnerCard, partnerEvents, Rendered, newsletterForm } from '../parts';

export const PUBLISHER = {
  '@type': 'Organization', name: 'Batoma', url: config.siteUrl,
  logo: { '@type': 'ImageObject', url: `${config.siteUrl}/icons/icon-512.png` },
};

export async function home(): Promise<Rendered> {
  const path = '/';
  const [featured, latest, trips, spotlight, deals, hero, sponsored, letter] = await Promise.all([
    data.articles({ featured: true, take: 3 }),
    data.articles({ take: 9 }),
    data.guides({ take: 3 }),
    data.partners({ take: 3 }),
    data.deals(3),
    data.liveAds('WEB_HOME_HERO'),
    data.liveAds('WEB_SPONSORED_ARTICLE'),
    data.liveAds('WEB_NEWSLETTER'),
  ]);
  const lead = featured[0] ?? latest[0];
  const more = [...featured.slice(1), ...latest].filter((a, i, all) => a.id !== lead?.id && all.findIndex((b) => b.id === a.id) === i).slice(0, 6);
  const heroAd = adSlot(hero[0], path);
  const storyAd = adSlot(sponsored[0], path);
  const letterAd = adSlot(letter[0], path);
  const shown = [lead, ...more].filter(Boolean) as data.ArticleCard[];

  const body = html`
<section class="intro wrap">
  <p class="kicker">Nepal, by road</p>
  <h1>Stories for the bus ride, and the places worth stopping for</h1>
  <p class="lede">Batoma is the magazine you find by scanning the code on your seat. Here it is in full: the stories, the road guides and the partners we have checked ourselves.</p>
</section>
${heroAd.html.value ? html`<div class="wrap">${heroAd.html}</div>` : ''}
<section class="wrap" aria-labelledby="h-stories">
  <div class="sec-head"><h2 id="h-stories">Latest stories</h2><a href="/magazine">All stories →</a></div>
  ${lead ? html`<div class="lead-grid">${articleCard(lead, { lead: true })}<div class="stack">${more.slice(0, 2).map((a) => articleCard(a))}</div></div>` : html`<p class="dim">The first stories are on their way.</p>`}
  <div class="grid">${more.slice(2, 5).map((a) => articleCard(a))}</div>
  ${storyAd.html}
</section>
<section class="band" aria-labelledby="h-trips">
  <div class="wrap">
    <div class="sec-head"><h2 id="h-trips">Trip ideas</h2><a href="/trips">All trips →</a></div>
    <div class="grid">${trips.map(guideCard)}</div>
  </div>
</section>
<section class="wrap" aria-labelledby="h-partners">
  <div class="sec-head"><h2 id="h-partners">Partners we have checked</h2><a href="/partners">All partners →</a></div>
  <p class="dim">Every partner is visited or verified by Batoma before they are listed. Featured partners pay for a higher place; it says so on their card.</p>
  <div class="grid">${spotlight.map(partnerCard)}</div>
</section>
${deals.length ? html`<section class="wrap" aria-labelledby="h-deals">
  <div class="sec-head"><h2 id="h-deals">Deals on the road</h2><a href="/deals">All deals →</a></div>
  <div class="grid">${deals.map(dealCard)}</div>
</section>` : ''}
<section class="wrap split">
  ${newsletterForm('home')}
  ${letterAd.html}
</section>`;

  return {
    html: page({
      title: 'Batoma', path,
      description: 'Batoma is a Nepal travel magazine: stories for the bus ride, road guides from Kathmandu to Pokhara and Chitwan, and partners checked by our team.',
      ld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Batoma', url: config.siteUrl, publisher: PUBLISHER }],
    }, body),
    events: [
      { type: 'PAGE_VIEW', path },
      ...heroAd.events, ...storyAd.events, ...letterAd.events,
      ...articleEvents(shown, path), ...partnerEvents(spotlight, path), ...partnerEvents(dealPartners(deals), path, 'deal'),
    ],
  };
}
