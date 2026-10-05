import { join } from 'path';

/**
 * Mixed English and Nepali text in server-made PDFs. The vendored Mukta files are split
 * by script, as the browser gets them, so text is drawn in runs, each with the file that
 * has its letters. fontkit shapes Devanagari conjuncts correctly within a run.
 */

const FONTS = join(__dirname, '../../../assets/fonts');

type Doc = PDFKit.PDFDocument;

/** Registers en, en-bold, ne and ne-bold on a document. */
export function registerMukta(doc: Doc) {
  doc.registerFont('en', join(FONTS, 'mukta-latin-400-normal.woff'));
  doc.registerFont('en-bold', join(FONTS, 'mukta-latin-700-normal.woff'));
  doc.registerFont('ne', join(FONTS, 'mukta-devanagari-400-normal.woff'));
  doc.registerFont('ne-bold', join(FONTS, 'mukta-devanagari-700-normal.woff'));
}

/** Devanagari letters and the joiners that shape them. */
const DEVANAGARI = /[\u0900-\u097F\u200C\u200D]/;

/**
 * Splits text into runs of one script, so each is drawn with the Mukta file that has its
 * letters (the vendored files are split by script, as the browser gets them). Spaces stay
 * with the run they sit in, which keeps a Nepali phrase shaped as one piece. Punctuation
 * and digits go to the Latin file: the Devanagari one has only the space and the danda.
 */
export function scriptRuns(text: string): Array<{ text: string; ne: boolean }> {
  const runs: Array<{ text: string; ne: boolean }> = [];
  for (const ch of text) {
    const neutral = /\s/.test(ch);
    const ne = DEVANAGARI.test(ch);
    const last = runs[runs.length - 1];
    if (last && (neutral || last.ne === ne)) last.text += ch;
    else runs.push({ text: ch, ne: neutral ? false : ne });
  }
  return runs;
}

/** Text in script runs, at x/y when given, otherwise where the last text ended. */
export function mixed(doc: Doc, text: string, opts: { bold?: boolean; size?: number; color?: string; x?: number; y?: number; width?: number; align?: 'left' | 'right' | 'center' } = {}) {
  const runs = scriptRuns(text || '');
  if (!runs.length) runs.push({ text: ' ', ne: false });
  doc.fontSize(opts.size ?? 10).fillColor(opts.color ?? '#1C1A2E');
  runs.forEach((run, i) => {
    doc.font(`${run.ne ? 'ne' : 'en'}${opts.bold ? '-bold' : ''}`);
    const continued = i < runs.length - 1;
    if (i === 0 && opts.x !== undefined) {
      doc.text(run.text, opts.x, opts.y, { width: opts.width, align: opts.align, continued });
    } else {
      doc.text(run.text, { width: opts.width, align: opts.align, continued });
    }
  });
}

