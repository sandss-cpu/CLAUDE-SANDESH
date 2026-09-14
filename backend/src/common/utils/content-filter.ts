/**
 * Words that route user text straight to human review (Apple Guideline 1.2).
 * One list for posts and comments so the two cannot drift apart.
 */
const AUTO_FLAG = ['kill', 'fraud', 'scam', 'whore', 'bitch', 'randi', 'chor'];

// Whole words only: a substring match held back "skills", "anchor" and "Chorten".
const PATTERN = new RegExp(`\\b(${AUTO_FLAG.join('|')})\\b`, 'i');

export function needsReview(...texts: Array<string | null | undefined>): boolean {
  return PATTERN.test(texts.filter(Boolean).join(' '));
}
