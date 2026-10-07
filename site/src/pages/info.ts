import { config } from '../config';
import { html, Html, raw } from '../html';
import { page } from '../layout';
import { crumbs, field, formError, formGuards, FormState, newsletterForm, Rendered, sentNote } from '../parts';

const simple = (path: string, title: string, description: string, body: Html, opts: { noindex?: boolean; status?: number } = {}): Rendered => ({
  html: page({ title, description, path, noindex: opts.noindex }, body),
  events: opts.noindex ? [] : [{ type: 'PAGE_VIEW', path }],
  status: opts.status,
});

export function write(state?: FormState & { sent?: boolean; devLink?: string }): Rendered {
  return simple('/write', 'Write a trip', 'Write about a trip in Nepal for Batoma: send your story from this page, and our editors may feature it with your name on it.', html`
<div class="wrap-narrow">
  ${crumbs([['/', 'Home'], ['', 'Write a trip']])}
  <h1>Write a trip for Batoma</h1>
  <p class="lede">The best stories in Batoma come from people who have just been there. If you have taken a road, stayed somewhere worth it or eaten something you still think about, write it up and send it to us here.</p>
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Send your story below.</strong> Your name and email are all you need. The first time, this also makes your Batoma account.</li>
    <li><strong>Confirm your email.</strong> We send you a link; your story reaches our editors when you follow it, and you can choose a password for your account.</li>
    <li><strong>Our editors read it.</strong> If it is right for Batoma, an editor prepares it with you and publishes it with your name on it.</li>
    <li><strong>Readers find it</strong> on the website, and on the bus, on the route it is about.</li>
  </ol>
  <h2>What we look for</h2>
  <ul>
    <li>Somewhere you actually went, recently. Prices and times go out of date quickly.</li>
    <li>The useful detail: which bus, where it stops, what the room was like, what to order.</li>
    <li>Your own words. If we feature your story, we will ask you for your own photos.</li>
    <li>Honesty. If you were given anything free, say so; we print it.</li>
  </ul>
  <section class="write-box" aria-labelledby="h-send">
    <h2 id="h-send">Send your story</h2>
    ${state?.sent ? html`${sentNote('Check your inbox: follow the link we have sent you and your story goes to our editors. The link works for 72 hours.')}
      ${state.devLink ? html`<p class="dev-note" role="note"><strong>Development:</strong> no email is sent on this computer. <a href="${state.devLink}">Open the confirmation link</a>.</p>` : ''}`
    : html`<form class="form" method="post" action="/write#h-send">
      ${formError(state)}
      ${field('name', 'Your name', state, { required: true, max: 80, autocomplete: 'name' })}
      ${field('email', 'Your email', state, { type: 'email', required: true, max: 254, autocomplete: 'email', hint: 'We send a link here to confirm it is you. It is never shown with your story.' })}
      ${field('title', 'Title', state, { required: true, max: 120, hint: 'For example: Two days in Bandipur on a budget.' })}
      ${field('place', 'Where it is about (optional)', state, { max: 80, hint: 'A town, a road or an area: Pokhara, the Prithvi Highway, Upper Mustang.' })}
      ${field('story', 'Your story', state, { textarea: true, rows: 16, required: true, max: 20000, hint: 'At least 300 characters, up to about 3,000 words. Plain text is fine; leave an empty line between paragraphs.' })}
      <div class="field check">
        <label><input type="checkbox" name="ownWork" value="yes" required${state?.values?.ownWork ? raw(' checked') : ''}> This is my own writing, about a trip I made.</label>
      </div>
      ${formGuards()}
      <button class="btn" type="submit">Send my story</button>
      <p class="small">Sending a story makes a Batoma account with this email, so you can sign in later; you can delete it at any time. See our <a href="/privacy">privacy notice</a>.</p>
    </form>`}
  </section>
  <p class="small">Already writing with us? <a href="${config.appUrl}/login.html">Sign in to the Batoma app</a> to share your travels there too.</p>
</div>`, { status: state?.error ? 400 : undefined });
}

/** /write/confirm: the email link shows a button; only the POST sends the story on. */
export function storyConfirmPage(token: string, outcome?: { ok: boolean; message?: string; title?: string; needsPassword?: boolean; devPasswordLink?: string }): Rendered {
  const body = !outcome
    ? html`<h1>Send your story to our editors</h1>
  <p class="lede">One tap and it is with them.</p>
  <form method="post" action="/write/confirm" class="form"><input type="hidden" name="token" value="${token}"><button class="btn" type="submit">Send my story</button></form>`
    : outcome.ok
      ? html`<h1>Your story is with our editors</h1>
  <p class="lede">Thank you for writing${outcome.title ? html` “${outcome.title}”` : ''}. Our editors read every story, and we will email you when they have.</p>
  ${outcome.needsPassword ? html`<p>We have also emailed you a link to choose a password for your Batoma account. It works for an hour; if it runs out, use “Forgot password” when you <a href="${config.appUrl}/login.html">sign in</a>.</p>` : html`<p>You can <a href="${config.appUrl}/login.html">sign in to Batoma</a> with your account as usual.</p>`}
  ${outcome.devPasswordLink ? html`<p class="dev-note" role="note"><strong>Development:</strong> no email is sent on this computer. <a href="${outcome.devPasswordLink}">Choose a password</a>.</p>` : ''}
  <p><a class="btn btn-ghost" href="/stories">Read the stories</a> <a class="btn btn-ghost" href="/write">Write another</a></p>`
      : html`<h1>That link did not work</h1>
  <p class="lede">${outcome.message ?? 'It may have expired or been used already.'}</p>
  <p><a class="btn" href="/write">Send your story again</a></p>`;
  return { html: page({ title: 'Send your story', description: 'Confirm your story for Batoma.', path: '/write/confirm', noindex: true }, html`<div class="wrap-narrow">${body}</div>`), events: [] };
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

export function advertise(state?: FormState & { sent?: boolean }): Rendered {
  return simple('/advertise', 'Advertise with Batoma', 'Batoma is a platform for tourism and for the people who explore Nepal. Reach travellers on the bus and on the web: listings, sponsored stories, sponsorships and monthly reports.', html`
<div class="wrap">
  ${crumbs([['/', 'Home'], ['', 'Advertise']])}
  <header class="page-head">
    <h1>Reach travellers on the road</h1>
    <p class="lede">Batoma is read on the bus, on the way to where your business is. A listing puts you in front of travellers at the moment they are deciding where to stop, stay or eat.</p>
  </header>
  <section class="mission" aria-label="Our vision and mission">
    <div class="mission-grid">
      <div class="mission-card">
        <h2>Our vision</h2>
        <p>A Nepal where every journey is part of the trip: where travellers know what lies ahead on the road, and the towns, homestays and people along the way are found, visited and valued.</p>
      </div>
      <div class="mission-card">
        <h2>Our mission</h2>
        <p>Batoma gives tourism, and the people who travel, one platform to explore Nepal. We put honest stories, road guides, events and checked local businesses in front of travellers wherever they are, on the bus, on their phone and on the web, so they discover more and the places along the road earn from it.</p>
      </div>
    </div>
    <h2 class="sr">What we stand for</h2>
    <ul class="values">
      <li><strong>Honest</strong> Anything paid for is labelled, and paying never buys a review.</li>
      <li><strong>Local</strong> Nepal's own businesses, writers and events, each checked by our team.</li>
      <li><strong>Made for the road</strong> Quick to load, and readable offline in the app when the signal goes.</li>
      <li><strong>Fair to partners</strong> A monthly report shows what you got for what you paid.</li>
    </ul>
  </section>
  <div class="two-col">
    <div>
      <h2>What partners get</h2>
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
  <p><a class="btn" href="/stories">Read the stories</a> <a class="btn btn-ghost" href="/">Home</a></p>
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

