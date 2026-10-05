import { strFromU8, unzipSync } from 'fflate';

/**
 * Reads the first worksheet of an .xlsx file into rows of text, using only fflate to
 * unzip: the npm `xlsx` package carries unfixed high-severity advisories. Spreadsheets
 * exported by booking portals are plain enough for this: shared and inline strings,
 * numbers, booleans and cached formula results. Cells styled as dates come back as
 * YYYY-MM-DD, read from the workbook's own number formats rather than guessed.
 */

/** Refuse anything that inflates past this: a small upload must not become a zip bomb. */
const MAX_UNZIPPED_BYTES = 25 * 1024 * 1024;
const NEEDED = /^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/worksheets\/[^/]+\.xml)$/;

export class XlsxError extends Error {}

export function readXlsx(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!NEEDED.test(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new XlsxError('This spreadsheet is too large to import. Split it by month.');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof XlsxError) throw e;
    throw new XlsxError('This is not a readable .xlsx file. Save it again from Excel, or export a CSV.');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new XlsxError('This is not a readable .xlsx file. Save it again from Excel, or export a CSV.');

  const sheetPath = firstSheetPath(workbook, text('xl/_rels/workbook.xml.rels'));
  const sheet = text(sheetPath);
  if (!sheet) throw new XlsxError('The spreadsheet has no worksheet to read.');

  const shared = sharedStrings(text('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIndexes(text('xl/styles.xml'));
  const date1904 = /<workbookPr[^>]*date1904="(1|true)"/.test(workbook);

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = [];
    for (const c of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : cells.length;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = allText(body);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'str' || type === 'e') value = decode(v ?? '');
      else if (v != null) value = dateStyles.has(style) ? serialToDay(Number(v), date1904) : v;
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.some((c) => c.trim() !== '')) rows.push(cells);
  }
  return rows;
}

function firstSheetPath(workbook: string, rels: string): string {
  const rid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1]
    ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : null;
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => allText(m[1]));
}

/** Every <t> in a string item, leaving out phonetic guides. */
function allText(xml: string): string {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
}

/** The cellXfs indexes whose number format is a date. */
function dateStyleIndexes(styles: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom.set(Number(m[1]), decode(m[2]));
  const isDate = (id: number) => {
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (id >= 27 && id <= 36) || (id >= 50 && id <= 58)) return true;
    const code = custom.get(id);
    // Strip quoted text, escaped characters and [colour]/[$locale] sections before looking for d, m, y.
    return !!code && /[dmy]/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''));
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => { if (isDate(Number(m[1]))) out.add(i); });
  return out;
}

/** Excel's day number to a calendar day. The 1900 system counts a 29 February 1900 that never was. */
function serialToDay(serial: number, date1904: boolean): string {
  if (!Number.isFinite(serial)) return '';
  const days = Math.floor(serial);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
