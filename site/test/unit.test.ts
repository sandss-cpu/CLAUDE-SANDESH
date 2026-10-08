import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkGuards, formToken } from '../src/forms';
import { html, jsonLd, raw, safeUrl } from '../src/html';
import { plain, storyHtml } from '../src/md';

test('html escapes everything interpolated unless it is markup made here', () => {
  const evil = '<script>alert("x")</script>';
  assert.equal(html`<p>${evil}</p>`.value, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>');
  assert.equal(html`<a title="${`" onmouseover="x`}">`.value, '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(html`<p>${raw('<b>ok</b>')}</p>`.value, '<p><b>ok</b></p>');
  assert.equal(html`<ul>${['<a>', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`.value, '<ul><li>&lt;a&gt;</li><li>b</li></ul>');
  assert.equal(html`${null}${undefined}${false}`.value, '');
});

test('only http(s) and site links reach an href', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl(' JAVASCRIPT:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,x'), '#');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeUrl('/partners/x'), '/partners/x');
});

test('JSON-LD cannot close its script element', () => {
  const out = jsonLd({ headline: '</script><script>alert(1)</script>' }).value;
  assert.equal(out.match(/<\/script>/g)?.length, 1);
  assert.ok(out.includes('\\u003c/script>'));
});

test('story markdown escapes first, then adds headings and emphasis', () => {
  const out = storyHtml('## The road\n\nA **bold** <img src=x onerror=alert(1)> and *quiet* morning.').value;
  assert.ok(out.includes('<h2 id="sec-1">The road</h2>'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<em>quiet</em>'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(plain('## Head\n\nSome **text** here', 160), 'Some text here');
});

test('form guards: honeypot, too fast, stale and tampered tokens', () => {
  const now = Date.now();
  assert.equal(checkGuards({ website: 'http://spam', t: formToken(now - 10_000) }, now), 'bot');
  assert.equal(checkGuards({ t: formToken(now - 500) }, now), 'bot');
  assert.equal(checkGuards({ t: formToken(now - 10_000) }, now), 'ok');
  assert.equal(checkGuards({ t: formToken(now - 25 * 3600_000) }, now), 'stale');
  assert.equal(checkGuards({}, now), 'stale');
  const [at] = formToken(now - 10_000).split('.');
  assert.equal(checkGuards({ t: `${at}.${'0'.repeat(32)}` }, now), 'stale');
  assert.equal(checkGuards({ t: `${at}.ééééééééééééééééééééééééééééééé` }, now), 'stale');
});

test('images: srcset from the upload sizes, and only safe addresses', async () => {
  const { img, srcset } = await import('../src/parts');
  assert.equal(srcset('https://cdn.example/u/abc-960.webp'), 'https://cdn.example/u/abc-480.webp 480w, https://cdn.example/u/abc-960.webp 960w');
  assert.equal(srcset('https://cdn.example/u/old.jpg'), null);
  const tag = img('https://cdn.example/u/abc-1600.webp', 'A "quoted" view', { sizes: '100vw', width: 1200, height: 750 }).value;
  assert.match(tag, /srcset="https:\/\/cdn\.example\/u\/abc-480\.webp 480w, .*abc-1600\.webp 1600w"/);
  assert.match(tag, /alt="A &quot;quoted&quot; view"/);
  assert.match(img('javascript:alert(1)', '', { sizes: '100vw', width: 1, height: 1 }).value, /src="#"/);
});

test('calendar files: escaped text, folded lines that never split a letter, and whole Kathmandu days', async () => {
  const { fold, icsFile, icsText } = await import('../src/ics');
  assert.equal(icsText('Lakeside, Pokhara; free\nentry \\ all'), 'Lakeside\\, Pokhara\\; free\\nentry \\\\ all');
  const long = `SUMMARY:${'काठमाडौं '.repeat(20)}`;
  const folded = fold(long);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'no line over 75 bytes');
  assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long, 'unfolding gives the line back');
  const base = { id: 'abc', title: 'Tihar lights', summary: 'Lights, sweets and songs.', url: 'https://batoma.example/events/tihar', city: 'Kathmandu', venue: 'Basantapur', address: null };
  // 9 to 11 November 2026, all day in Kathmandu (midnight there is 18:15 UTC the day before).
  const allDay = icsFile({ ...base, allDay: true, cancelled: false, startsAt: new Date('2026-11-08T18:15:00Z'), endsAt: new Date('2026-11-10T18:15:00Z') }, 'batoma.example', new Date('2026-10-07T00:00:00Z'));
  assert.match(allDay, /DTSTART;VALUE=DATE:20261109\r\n/);
  assert.match(allDay, /DTEND;VALUE=DATE:20261112\r\n/, 'the end is the day after the last day');
  assert.match(allDay, /UID:abc@batoma\.example\r\n/);
  assert.match(allDay, /LOCATION:Basantapur\\, Kathmandu\r\n/);
  assert.match(allDay, /STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);
  const timed = icsFile({ ...base, allDay: false, cancelled: true, startsAt: new Date('2026-11-09T12:15:00Z'), endsAt: null }, 'batoma.example');
  assert.match(timed, /DTSTART:20261109T121500Z\r\n/);
  assert.doesNotMatch(timed, /DTEND/, 'no end given, none made up');
  assert.match(timed, /STATUS:CANCELLED/);
});

test('dates: the Kathmandu day decides the BS date, and an event reads in Kathmandu time', async () => {
  const { dayBs, eventWhen, kathmanduDay } = await import('../src/format');
  // 19:00 UTC on 9 October is 00:45 on 10 October in Kathmandu.
  assert.equal(kathmanduDay(new Date('2026-10-09T19:00:00Z')), '2026-10-10');
  assert.equal(dayBs(new Date('2026-10-09T19:00:00Z')), dayBs(new Date('2026-10-10T06:00:00Z')));
  assert.notEqual(dayBs(new Date('2026-10-09T19:00:00Z')), dayBs(new Date('2026-10-09T06:00:00Z')));
  const evening = eventWhen({ startsAt: new Date('2026-10-10T12:15:00Z'), endsAt: new Date('2026-10-10T15:15:00Z'), allDay: false });
  assert.match(evening.ad, /^Saturday,? 10 October 2026, 18:00–21:00$/);
  const days = eventWhen({ startsAt: new Date('2026-11-08T18:15:00Z'), endsAt: new Date('2026-11-10T18:15:00Z'), allDay: true });
  assert.match(days.ad, /^Monday,? 9 November 2026 – Wednesday,? 11 November 2026$/);
  assert.ok(days.bs.includes(' – '));
});

test('the total of a journey is the sum of the costs given, or nothing when none are', async () => {
  const { journeyTotal } = await import('../src/pages/creators');
  assert.equal(journeyTotal({ transportNpr: 1200, stayNpr: 4500, foodNpr: 3000, permitsNpr: null, otherNpr: 1000 }), 9700);
  assert.equal(journeyTotal({ transportNpr: null, stayNpr: null, foodNpr: null, permitsNpr: null, otherNpr: null }), null);
  assert.equal(journeyTotal({ transportNpr: 0, stayNpr: null, foodNpr: null, permitsNpr: null, otherNpr: null }), 0);
});

