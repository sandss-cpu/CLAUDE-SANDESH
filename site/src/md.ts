import { esc, Html, raw } from './html';

/**
 * The small markdown editors write, as on the reader: ## and ### headings, paragraphs,
 * **bold** and *italics*. Text is escaped before any markup is added.
 */
export function storyHtml(text: string): Html {
  const out: string[] = [];
  let n = 0;
  for (const chunk of String(text || '').split(/\n{2,}/)) {
    const lines = chunk.trim().split('\n');
    while (lines.length && /^#{2,3}\s+\S/.test(lines[0])) {
      const [, hashes, title] = /^(#{2,3})\s+(.+)$/.exec(lines.shift()!)!;
      n += 1;
      const tag = hashes.length === 2 ? 'h2' : 'h3';
      out.push(`<${tag} id="sec-${n}">${esc(title.trim())}</${tag}>`);
    }
    const t = lines.join('\n').trim();
    if (!t) continue;
    out.push(`<p>${esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br>')}</p>`);
  }
  return raw(out.join('\n'));
}

/** Plain text for descriptions: no markup, one line, cut at a word. */
export function plain(text: string | null | undefined, max = 160): string {
  const t = String(text ?? '').replace(/^#+\s.*$/gm, '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}
