import PDFDocument from 'pdfkit';
import { mixed as mixedText, registerMukta } from '../../common/pdf/mixed-text';
import { formatBs, kathmanduDay } from '../../common/utils/bs-date';
import type { AppraisalView } from './appraisals.service';
import type { Criterion, Suggestion } from './scorecard';

const INK = '#1C1A2E';
const DIM = '#5A5568';
const BRAND = '#5B3FA8';
const LINE = '#E4DED0';

/** English and Nepali labels, side by side as on a Nepali office form. */
const CRITERIA_LABELS: Array<[Criterion, string, string]> = [
  ['driving', 'Passenger driving score', 'यात्रुले दिएको चालक अंक'],
  ['punctuality', 'Punctuality', 'समयपालन'],
  ['conduct', 'Conduct', 'आचरण'],
  ['safety', 'Safety record', 'सुरक्षा रेकर्ड'],
  ['vehicleCare', 'Vehicle care', 'सवारी साधनको हेरचाह'],
  ['attendance', 'Attendance', 'हाजिरी'],
];
const OUTCOMES: Record<string, [string, string]> = {
  NONE: ['None', 'केही छैन'],
  COMMENDATION: ['Commendation', 'प्रशंसा'],
  BONUS: ['Bonus', 'बोनस'],
  TRAINING: ['Training', 'तालिम'],
  WARNING: ['Warning', 'चेतावनी'],
};
const ROLES: Record<string, [string, string]> = {
  DRIVER: ['Driver', 'चालक'], CONDUCTOR: ['Conductor', 'सहचालक'], HELPER: ['Helper', 'सहयोगी'],
};

type Doc = PDFKit.PDFDocument;
const mixed = (doc: Doc, text: string, opts: Parameters<typeof mixedText>[2] = {}) => mixedText(doc, text, { color: INK, ...opts });

const both = (en: string, ne: string) => `${en} · ${ne}`;
/** An instant as its Kathmandu day, AD then BS. */
const dates = (at: string | Date | null) => {
  if (!at) return '—';
  const d = kathmanduDay(at);
  const bs = formatBs(d);
  return bs ? `${d} (${bs} BS)` : d;
};

/** A printable appraisal: A4, English and Nepali labels, AD and BS dates, signature lines. */
export function appraisalPdf(a: AppraisalView): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 48, bottom: 48, left: 52, right: 52 },
      info: { Title: `Appraisal: ${a.driver.name}`, Author: a.company, Creator: 'Batoma' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerMukta(doc);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Header
    doc.rect(0, 0, doc.page.width, 8).fill(BRAND);
    mixed(doc, a.company, { bold: true, size: 18, x: left, y: 30, width });
    mixed(doc, both('Crew appraisal', 'कर्मचारी मूल्याङ्कन'), { size: 12, color: DIM, width });
    if (a.status === 'DRAFT') {
      mixed(doc, both('DRAFT: not final', 'मस्यौदा: अन्तिम होइन'), { bold: true, size: 11, color: '#B42318', width });
    }
    doc.moveDown(0.6);

    const role = ROLES[a.driver.role] ?? [a.driver.role, ''];
    const field = (en: string, ne: string, value: string) => {
      const y = doc.y;
      mixed(doc, both(en, ne), { size: 9, color: DIM, x: left, y, width: 190 });
      mixed(doc, value, { size: 11, x: left + 196, y, width: width - 196 });
      doc.moveDown(0.25);
    };
    field('Name', 'नाम', a.driver.name);
    field('Role', 'पद', both(role[0], role[1]));
    field('Period', 'अवधि', `${a.period.from} – ${a.period.to}  (${a.period.fromBs} – ${a.period.toBs} BS)`);
    field('Appraiser', 'मूल्याङ्कनकर्ता', a.appraiser ?? '—');

    // Scores
    doc.moveDown(0.6);
    mixed(doc, both('Scores (1 to 5)', 'अंक (१ देखि ५)'), { bold: true, size: 12, x: left, y: doc.y, width });
    doc.moveDown(0.3);
    const criteria = (a.suggested as { criteria?: Record<Criterion, Suggestion> } | null)?.criteria;
    for (const [key, en, ne] of CRITERIA_LABELS) {
      const y = doc.y;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(LINE).stroke();
      const value = a.scores[key];
      mixed(doc, en, { bold: true, size: 10, x: left, y: y + 5, width: 200 });
      mixed(doc, ne, { size: 10, color: DIM, x: left, y: doc.y, width: 200 });
      const after = doc.y;
      mixed(doc, value == null ? '—' : `${value} / 5`, { bold: true, size: 14, x: left + 206, y: y + 6, width: 60 });
      const basis = criteria?.[key];
      if (basis) {
        const why = basis.basis.charAt(0).toLowerCase() + basis.basis.slice(1);
        mixed(doc, basis.value == null ? `No suggestion from the data: ${why}.` : `The data suggested ${basis.value}: ${why}.`,
          { size: 8.5, color: DIM, x: left + 272, y: y + 6, width: width - 272 });
      }
      doc.y = Math.max(after, doc.y) + 6;
    }
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.moveDown(0.4);
    mixed(doc, `${both('Average', 'औसत')}: ${a.average == null ? '—' : `${a.average} / 5`}`, { bold: true, size: 11, x: left, y: doc.y, width });

    // Words
    const block = (en: string, ne: string, text: string | null) => {
      doc.moveDown(0.6);
      mixed(doc, both(en, ne), { bold: true, size: 11, x: left, y: doc.y, width });
      doc.moveDown(0.15);
      mixed(doc, text?.trim() || '—', { size: 10.5, x: left, y: doc.y, width });
    };
    block('Strengths', 'सबल पक्ष', a.strengths);
    block('Goals for the next period', 'आगामी अवधिका लक्ष्य', a.goals);
    block('Comments', 'टिप्पणी', a.comments);

    const outcome = OUTCOMES[a.outcome] ?? [a.outcome, ''];
    doc.moveDown(0.6);
    mixed(doc, `${both('Outcome', 'नतिजा')}: ${both(outcome[0], outcome[1])}`, { bold: true, size: 11, x: left, y: doc.y, width });
    doc.moveDown(0.3);
    field('Finalised', 'अन्तिम गरिएको', dates(a.finalisedAt));
    field('Discussed with the driver', 'चालकसँग छलफल', dates(a.acknowledgedAt));

    // Signatures straight after the content, and the footnote in the bottom margin. The
    // margin is lifted while they are drawn: text placed below it makes pdfkit start a page.
    // The labels end 44pt below y; the footnote starts 30pt above the page's edge.
    let y = doc.y + 18;
    if (y + 44 > doc.page.height - 36) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.page.margins.bottom = 0;
    const half = (width - 40) / 2;
    for (const [i, [en, ne]] of [['Crew member signature', 'कर्मचारीको हस्ताक्षर'], ['Appraiser signature', 'मूल्याङ्कनकर्ताको हस्ताक्षर']].entries()) {
      const x = left + i * (half + 40);
      doc.moveTo(x, y + 28).lineTo(x + half, y + 28).lineWidth(0.7).strokeColor(INK).stroke();
      mixed(doc, both(en, ne), { size: 9, color: DIM, x, y: y + 32, width: half });
    }
    mixed(doc, 'Prepared with Batoma from trips, fuel, incidents and passenger reviews. Reviewers are never named.',
      { size: 7.5, color: DIM, x: left, y: doc.page.height - 30, width });

    doc.end();
  });
}
