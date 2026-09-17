import { needsReview } from './content-filter';

describe('needsReview', () => {
  it('flags a word from the list', () => {
    expect(needsReview('this place is a scam')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(needsReview('SCAM')).toBe(true);
  });

  /**
   * The reason the filter matches whole words: a substring match held back
   * ordinary posts about skills, anchors and Chorten, which is worse than
   * missing an insult, because the author never learns why.
   */
  it.each(['a post about my skills', 'the anchor at the lakeside', 'Chorten on the ridge'])(
    'does not flag %p',
    (text) => expect(needsReview(text)).toBe(false),
  );

  it('checks every field it is given', () => {
    expect(needsReview('a fine title', null, 'but the body is a scam')).toBe(true);
  });

  it('ignores empty and missing values', () => {
    expect(needsReview(null, undefined, '')).toBe(false);
  });
});
