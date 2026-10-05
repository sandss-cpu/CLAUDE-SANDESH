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
