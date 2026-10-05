import { cleanKeyPoints, firstSentence, publishProblem } from './brief';

describe('article brief', () => {
  it('takes the first sentence, without headings or emphasis', () => {
    expect(firstSentence('## On the road\n\nEverybody stops at **Malekhu** for fish. The river is right there.'))
      .toBe('Everybody stops at Malekhu for fish.');
    expect(firstSentence('बन्दीपुर पुरानो बजार हो। यहाँ धेरै छ।')).toBe('बन्दीपुर पुरानो बजार हो।');
  });
  it('cuts a long opening at a word, with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const s = firstSentence(long)!;
    expect(s.length).toBeLessThanOrEqual(151);
    expect(s.endsWith('word…')).toBe(true);
  });
  it('has nothing to say about an empty body', () => {
    expect(firstSentence('')).toBeNull();
    expect(firstSentence('## Only a heading')).toBeNull();
  });
  it('keeps up to three key points, dropping blanks', () => {
    expect(cleanKeyPoints([' a ', '', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
  });
  it('says what is missing before an article can be published', () => {
    expect(publishProblem({ summary: '', keyPoints: ['x'] })).toMatch(/summary/);
    expect(publishProblem({ summary: 'A line.', keyPoints: [' '] })).toMatch(/key points/);
    expect(publishProblem({ summary: 'A line.', keyPoints: ['x'] })).toBeNull();
  });
});
