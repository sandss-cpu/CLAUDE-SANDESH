import { couponCode, readMinutes, shortCode, slugify, uniqueSlug } from './slug.util';

describe('slugify', () => {
  it('makes a url-safe slug', () => {
    expect(slugify('Two hours in Bandipur!')).toBe('two-hours-in-bandipur');
  });

  it('strips accents rather than dropping the word', () => {
    expect(slugify('Héllo World')).toBe('hello-world');
  });

  it('collapses runs of spaces, underscores and dashes', () => {
    expect(slugify('  a   b__c--d  ')).toBe('a-b-c-d');
  });

  it('falls back to something usable when nothing survives', () => {
    expect(slugify('!!!')).toBe('');
  });

  it('caps the length', () => {
    expect(slugify('x'.repeat(200)).length).toBe(80);
  });
});

describe('uniqueSlug', () => {
  it('returns the plain slug when it is free', async () => {
    expect(await uniqueSlug('Bandipur Inn', async () => false)).toBe('bandipur-inn');
  });

  it('appends a number until it finds a free one', async () => {
    const taken = new Set(['bandipur-inn', 'bandipur-inn-2']);
    expect(await uniqueSlug('Bandipur Inn', async (s) => taken.has(s))).toBe('bandipur-inn-3');
  });

  it('uses a fallback root when the name has no usable characters', async () => {
    expect(await uniqueSlug('!!!', async () => false)).toBe('item');
  });
});

describe('codes', () => {
  /** Codes get read off a sticker or a screen, so lookalike characters are out. */
  it('avoids characters that are misread', () => {
    const sample = Array.from({ length: 200 }, () => couponCode()).join('');
    expect(sample).not.toMatch(/[01OI]/);
  });

  it('has the documented lengths', () => {
    expect(couponCode()).toHaveLength(6);
    expect(shortCode()).toHaveLength(8);
  });
});

describe('readMinutes', () => {
  it('rounds to the nearest minute at 200 words', () => {
    expect(readMinutes('word '.repeat(400))).toBe(2);
  });

  it('never claims less than a minute', () => {
    expect(readMinutes('')).toBe(1);
    expect(readMinutes('three short words')).toBe(1);
  });
});
