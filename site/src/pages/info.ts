import { config } from '../config';
import * as data from '../data';
import { html, Html } from '../html';
import { page } from '../layout';
import { crumbs, field, formError, formGuards, FormState, newsletterForm, Rendered, sentNote } from '../parts';

const simple = (path: string, title: string, description: string, body: Html, opts: { noindex?: boolean; status?: number } = {}): Rendered => ({
  html: page({ title, description, path, noindex: opts.noindex }, body),
  events: opts.noindex ? [] : [{ type: 'PAGE_VIEW', path }],
  status: opts.status,
});

export function write(): Rendered {
  return simple('/write', 'Write a trip', 'Write about a trip in Nepal for the Batoma magazine: how it works, what our editors look for, and how to start.', html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['', 'Write a trip']])}
  <h1>Write a trip for Batoma</h1>
  <p class="lede">The best stories in Batoma come from people who have just been there. If you have taken a road, stayed somewhere worth it or eaten something you still think about, write it up.</p>
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Sign in to the Batoma app</strong> and open <em>Write</em>. An email address is all you need.</li>
    <li><strong>Write your trip</strong>: where you went, how you got there, what it cost and what you would tell a friend. Add photos you took.</li>
    <li><strong>Our editors read it.</strong> The good ones are edited with you, then published in the magazine with your name on them.</li>
    <li><strong>Readers on the bus find it</strong> on the route it is about.</li>
  </ol>
  <h2>What we look for</h2>
  <ul>
    <li>Somewhere you actually went, recently. Prices and times go out of date quickly.</li>
    <li>The useful detail: which bus, where it stops, what the room was like, what to order.</li>
    <li>Your own words and your own photos.</li>
    <li>Honesty. If you were given anything free, say so; we print it.</li>
  </ul>
  <p><a class="btn" href="${config.appUrl}/#write">Start writing in the app</a></p>
  <p class="small">Writing often? Ask about a creator profile in the app, under <em>Write</em>.</p>
</div>`);
}

export function about(): Rendered {
  return simple('/about', 'About Batoma', 'Batoma is a Nepal travel magazine reached by scanning the code on a bus seat. What we publish, how we check partners and how we label ads.', html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['', 'About']])}
  <h1>About Batoma</h1>
  <p class="lede">Batoma is a travel magazine for Nepal's roads. Most readers find it by scanning the code on their bus seat: the stories, the road ahead and the places worth stopping for, on their phone, offline if the signal goes.</p>
  <h2>What we publish</h2>
  <p>Stories about the road, food, heritage, festivals, trekking and wildlife, written by our editors and by travellers. Road guides that follow the highway stop by stop. Partner listings for places to stay, eat and book.</p>
  <h2>How we check partners</h2>
  <p>A business is listed only after Batoma has verified it: we check that it exists, that it is where it says it is and that the person listing it runs it. Partners can pay for a higher place or a featured slot. That never buys a good review, and it is always labelled.</p>
  <h2>How we label what is paid for</h2>
  <p>Anything a partner pays for carries a <span class="sponsored">Sponsored</span> label with the partner's name: sponsored stories, spotlight slots, section and place partners, featured deals. Links that a partner pays for are marked for search engines too.</p>
  <h2>What we do not do</h2>
  <p>No tracking cookies and no advertising networks on this site. We count visits ourselves, in a way that cannot be traced back to you. Our <a href="/privacy">privacy notice</a> has the detail.</p>
  <p><a class="btn btn-ghost" href="/contact">Contact us</a> <a class="btn btn-ghost" href="/advertise">Advertise</a></p>
</div>`);
}

export function contact(state?: FormState & { sent?: boolean }): Rendered {
  return simple('/contact', 'Contact', 'Write to Batoma: corrections, story ideas, partner questions or anything else.', html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['', 'Contact']])}
  <h1>Contact Batoma</h1>
  <p class="lede">Corrections, story ideas, questions about a partner, or a problem with the app. We read everything and answer within two working days.</p>
  ${state?.sent ? sentNote('Your message is with us. We will reply to the contact you gave.') : html`
  <form class="form" method="post" action="/contact">
    ${formError(state)}
    ${field('name', 'Your name', state, { required: true, max: 80, autocomplete: 'name' })}
    ${field('contact', 'Phone or email for the reply', state, { required: true, max: 120, autocomplete: 'email' })}
    ${field('message', 'Message', state, { required: true, max: 4000, textarea: true })}
    ${formGuards()}
    <button class="btn" type="submit">Send</button>
    <p class="small">We keep your message so we can answer it. See our <a href="/privacy">privacy notice</a>.</p>
  </form>`}
  <p class="small">Partners: your enquiries and monthly report are in the business area of the <a href="${config.appUrl}/">Batoma app</a>.</p>
</div>`, { status: state?.error ? 400 : undefined });
}

interface Audience { scansLast30Days: number; readersLast30Days: number; websiteViewsLast30Days: number; buses: number; routes: number; partners: number; articles: number }

/** The API's public figures; the page still works if the API is down. */
async function audience(): Promise<Audience | null> {
  try {
    const res = await fetch(`${config.apiUrl}/site/audience`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Audience };
    return typeof body.data?.buses === 'number' ? body.data : null;
  } catch { return null; }
}

const n = (v: number) => v.toLocaleString('en-IN');

export async function advertise(state?: FormState & { sent?: boolean }): Promise<Rendered> {
  const [a, partners] = await Promise.all([audience(), data.partners({ take: 200 })]);
  const figures: Array<[string, string]> = a
    ? [[n(a.readersLast30Days), 'readers on buses, last 30 days'], [n(a.scansLast30Days), 'seat-code scans, last 30 days'],
       [n(a.websiteViewsLast30Days), 'website page views, last 30 days'], [n(a.buses), `buses on ${n(a.routes)} ${a.routes === 1 ? 'route' : 'routes'}`],
       [n(a.articles), 'stories published']]
    : [[n(partners.length), 'verified partners listed']];
  return simple('/advertise', 'Advertise with Batoma', 'Reach travellers on the bus and on the Batoma website: partner listings, sponsored stories, route and place sponsorships, and monthly reports.', html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['', 'Advertise']])}
  <header class="page-head">
    <h1>Reach travellers on the road</h1>
    <p class="lede">Batoma is read on the bus, on the way to where your business is. A listing puts you in front of them at the moment they are deciding where to stop, stay or eat.</p>
  </header>
  <ul class="figures" aria-label="Audience">${figures.map(([v, label]) => html`<li><strong>${v}</strong><span>${label}</span></li>`)}</ul>
  <div class="two-col">
    <div>
      <h2>What you can buy</h2>
      <dl class="offer-list">
        <dt>Verified listing</dt><dd>Your page on the website and in the app, on the road guides for your route, with calls, WhatsApp, directions and enquiries.</dd>
        <dt>Featured partner</dt><dd>A higher place in lists and on the road, and the home page partner spotlight.</dd>
        <dt>Sponsored story</dt><dd>A story about you, written and checked by our editors, labelled with your name.</dd>
        <dt>Section or place partner</dt><dd>Your name on every story in a section, or on everything about a place.</dd>
        <dt>Deals</dt><dd>Coupons readers claim in the app and show when they pay; we count claims and redemptions.</dd>
        <dt>Newsletter partner</dt><dd>One partner per issue of the Batoma letter.</dd>
      </dl>
      <p>Every partner gets a monthly report: impressions and clicks on the website, profile views and calls in the app, enquiries, and coupons claimed and redeemed. You can download it as a spreadsheet or PDF.</p>
      <p class="small">Everything paid for is labelled. Paying never buys a review or a rating.</p>
    </div>
    <section aria-labelledby="h-ask">
      <h2 id="h-ask">Ask about rates</h2>
      ${state?.sent ? sentNote('We will be in touch within two working days.') : html`
      <form class="form" method="post" action="/advertise#h-ask">
        ${formError(state)}
        ${field('name', 'Your name', state, { required: true, max: 80, autocomplete: 'name' })}
        ${field('organisation', 'Business name', state, { max: 120, autocomplete: 'organization' })}
        ${field('contact', 'Phone or email', state, { required: true, max: 120, autocomplete: 'email' })}
        ${field('message', 'What would you like?', state, { required: true, max: 4000, textarea: true, hint: 'Where you are, what you offer, and anything you have in mind.' })}
        ${formGuards()}
        <button class="btn" type="submit">Send enquiry</button>
      </form>`}
    </section>
  </div>
</div>`, { status: state?.error ? 400 : undefined });
}

const DRAFT = html`<p class="draft" role="note"><strong>Draft: needs legal review.</strong> This page has not yet been checked by a lawyer and may change before Batoma launches.</p>`;

export function privacy(): Rendered {
  // A draft is kept out of search until a lawyer has reviewed it.
  return simple('/privacy', 'Privacy notice', 'What Batoma collects on this website and in the app, why, how long it is kept, and how to ask for it or have it deleted.', html`
<div class="wrap-narrow legal">
  ${crumbs([['/', 'Home'], ['', 'Privacy']])}
  <h1>Privacy notice</h1>
  ${DRAFT}
  <p>Batoma publishes a travel magazine on this website and in the Batoma app. This notice says what we collect, why, and what you can ask of us. It is written to meet Nepal's Individual Privacy Act, 2075 (2018).</p>
  <h2>On this website</h2>
  <ul>
    <li><strong>No cookies and no tracking scripts.</strong> There is no advertising network and no outside analytics here.</li>
    <li><strong>Visit counts.</strong> When you open a page we record the page, the website that sent you (its name only), and a visit code. The visit code is a one-way scramble of your network address, your browser's name and the half-hour you visited; it changes every half-hour and cannot be turned back into your address. We use these counts to see what people read and to report to partners how often they were shown and clicked.</li>
    <li><strong>Messages to partners.</strong> If you send a partner a message, we pass your name, contact and message to that partner by email and keep a copy, so we can check partners answer.</li>
    <li><strong>Messages to us.</strong> Contact and advertising enquiries are kept so we can answer them.</li>
    <li><strong>The newsletter.</strong> We keep your email address, when you subscribed and confirmed, and where you signed up. Nothing is sent until you confirm by email, and every newsletter has a one-click unsubscribe link.</li>
    <li><strong>Server logs.</strong> Our hosting provider keeps short-lived technical logs, which may include network addresses, to keep the service running and safe.</li>
  </ul>
  <h2>In the Batoma app</h2>
  <ul>
    <li><strong>Scanning a bus code</strong> records the code, the time and a random code for your device, so we can count readers. The app asks for your location only if you hold the SOS button, and sends it with the alert.</li>
    <li><strong>Accounts.</strong> If you sign in, we keep your email address and name. Bus companies, partners and our staff use extra security, including sign-in codes.</li>
    <li><strong>Reviews of a bus.</strong> Your rating and comment are shown to the bus company and to other travellers, after a check by our moderators, without your name: the company never sees who wrote them. A private suggestion goes to the company only.</li>
    <li><strong>Stories you write</strong> are published with the name you choose.</li>
  </ul>
  <h2>Who else sees it</h2>
  <p>Partners see the messages sent to them and counts, never who you are. Bus companies see reviews of their buses. Our hosting, storage and email providers process data for us under contract. We do not sell personal data.</p>
  <h2>How long we keep it</h2>
  <p>Visit counts and scan records are kept in full for up to 13 months, then reduced to totals. Messages are kept while they are useful to answer and for our records. You can ask us to delete your account and what is linked to it at any time.</p>
  <h2>Your rights</h2>
  <p>You can ask to see what we hold about you, to correct it, or to delete it. Write to us through the <a href="/contact">contact page</a> and we will answer within 30 days.</p>
  <h2>Changes</h2>
  <p>If this notice changes, the new version is published here with its date.</p>
</div>`, { noindex: true });
}

export function terms(): Rendered {
  return simple('/terms', 'Terms of use', 'The terms for using the Batoma website and app, partner listings, deals and what you post.', html`
<div class="wrap-narrow legal">
  ${crumbs([['/', 'Home'], ['', 'Terms']])}
  <h1>Terms of use</h1>
  ${DRAFT}
  <h2>Using Batoma</h2>
  <p>You may read, share links to and print Batoma stories for your own use. The stories, photos and road guides belong to Batoma or to the people who made them; do not republish them without permission.</p>
  <h2>Partners and bookings</h2>
  <p>Batoma checks partners before listing them, but we are not party to anything you arrange with them. Prices, rooms, tours and bookings are between you and the partner. If something goes wrong, tell us: we take listings down.</p>
  <h2>Deals</h2>
  <p>Deals are offered by partners, on their terms, until the date shown and while the partner allows. Batoma does not pay for or guarantee them.</p>
  <h2>What you post</h2>
  <p>When you write a review or a story in the app, you keep it, and you allow Batoma to publish, edit for length and clarity, and show it on the website and in the app. Do not post anything false, hateful, private about someone else or that you do not have the right to share. We may remove anything that breaks these terms.</p>
  <h2>Road information</h2>
  <p>Road guides, times and distances are written with care but roads, prices and timetables change. Check before you rely on them, especially in the monsoon.</p>
  <h2>Liability</h2>
  <p>Batoma is provided as it is. As far as the law allows, we are not liable for losses arising from using it or from dealing with a partner.</p>
  <h2>Law</h2>
  <p>These terms are governed by the laws of Nepal.</p>
</div>`, { noindex: true });
}

export function newsletterPage(state?: FormState & { sent?: boolean }): Rendered {
  return simple('/newsletter', 'The Batoma letter', 'New stories, road guides and partner deals from Batoma, about twice a month.', html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['', 'Newsletter']])}
  <h1 class="sr">Newsletter</h1>
  ${newsletterForm('newsletter-page', state, state?.sent)}
</div>`, { status: state?.error ? 400 : undefined });
}

/**
 * The confirm and unsubscribe links in emails open a page with a button. Mail scanners
 * follow links; they do not press buttons, so nobody is subscribed or removed by a robot.
 */
export function tokenPage(kind: 'confirm' | 'unsubscribe', token: string, outcome?: { ok: boolean; unsubscribeToken?: string }): Rendered {
  const path = `/newsletter/${kind}`;
  const heading = kind === 'confirm' ? 'Confirm your subscription' : 'Unsubscribe';
  let body: Html;
  if (outcome?.ok && kind === 'confirm') {
    body = html`<h1>You are subscribed</h1><p class="lede">The next Batoma letter will come to you.</p>
      ${outcome.unsubscribeToken ? html`<p class="small">Changed your mind? <a href="/newsletter/unsubscribe?token=${outcome.unsubscribeToken}">Unsubscribe</a>.</p>` : ''}`;
  } else if (outcome?.ok) {
    body = html`<h1>You are unsubscribed</h1><p class="lede">No more Batoma letters will be sent to you.</p>`;
  } else if (outcome) {
    body = html`<h1>${heading}</h1><p class="form-error" role="alert">This link has expired or was already used.</p><p><a href="/newsletter">Subscribe again</a></p>`;
  } else {
    body = html`<h1>${heading}</h1>
      <form method="post" action="${path}" class="form">
        <input type="hidden" name="token" value="${token}">
        <button class="btn" type="submit">${kind === 'confirm' ? 'Yes, send me the Batoma letter' : 'Unsubscribe me'}</button>
      </form>`;
  }
  return simple(path, heading, 'The Batoma letter.', html`<div class="wrap-narrow">${body}</div>`, { noindex: true, status: outcome && !outcome.ok ? 400 : undefined });
}

export function notFound(): Rendered {
  return simple('/404', 'Page not found', 'This page is not on Batoma.', html`
<div class="wrap-narrow">
  <h1>We could not find that page</h1>
  <p class="lede">It may have moved, or the story may no longer be published.</p>
  <p><a class="btn" href="/magazine">Read the magazine</a> <a class="btn btn-ghost" href="/">Home</a></p>
</div>`, { noindex: true, status: 404 });
}

export function serverError(): Rendered {
  return simple('/500', 'Something went wrong', 'Batoma could not show this page.', html`
<div class="wrap-narrow">
  <h1>Something went wrong</h1>
  <p class="lede">We could not show this page just now. Try again in a minute.</p>
  <p><a class="btn" href="/">Home</a></p>
</div>`, { noindex: true, status: 500 });
}

