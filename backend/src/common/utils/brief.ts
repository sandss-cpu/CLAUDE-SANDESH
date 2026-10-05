/**
 * The one-line summary for an article card, from the start of its body: the first
 * sentence (ending in . ! ? or the Devanagari danda) if it fits in 160 characters,
 * otherwise the opening cut at a word with an ellipsis. Headings and markdown emphasis
 * are left out. The article_brief migration backfilled existing articles the same way.
 */
export const SUMMARY_MAX = 160;
export const KEY_POINTS_MAX = 3;

export function firstSentence(body: string | null | undefined): string | null {
  const text = (body ?? '')
    .replace(/^#+[^\n]*$/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const sentence = /^(.{10,159}?[.!?।])(?:\s|$)/u.exec(text);
  if (sentence) return sentence[1];
  if (text.length <= SUMMARY_MAX) return text;
  const cut = /^(.{1,150})(?:\s|$)/u.exec(text)?.[1] ?? text.slice(0, 150);
  return `${cut.trimEnd()}…`;
}

/** Key points as an editor typed them: trimmed, blanks dropped, at most three. */
export function cleanKeyPoints(points: string[] | null | undefined): string[] {
  return (points ?? []).map((p) => p.trim()).filter(Boolean).slice(0, KEY_POINTS_MAX);
}

/** Why an article cannot be published yet, or null if it can. */
export function publishProblem(a: { summary?: string | null; keyPoints?: string[] | null }): string | null {
  if (!a.summary?.trim()) return 'Add a one-line summary (160 characters or fewer) before publishing.';
  if (!cleanKeyPoints(a.keyPoints).length) return 'Add one to three key points for the “In brief” box before publishing.';
  return null;
}
