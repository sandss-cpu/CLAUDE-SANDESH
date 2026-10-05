import PDFDocument from 'pdfkit';
import { mixed, registerMukta } from '../../common/pdf/mixed-text';
import { formatPaisa } from './money';
import type { incomeReport } from './reports';

const INK = '#1C1A2E';
const DIM = '#5A5568';
const BRAND = '#5B3FA8';
const LINE = '#E4DED0';
const GROUP = { bus: ['Bus', 'बस'], route: ['Route', 'रुट'], driver: ['Driver', 'चालक'] } as const;

type Report = ReturnType<typeof incomeReport>;

/** The income report on A4 landscape: totals first, then one line per bus, route or driver. */
export function incomePdf(input: {
  company: string; groupBy: 'bus' | 'route' | 'driver';
  period: { from: string; to: string; fromBs: string; toBs: string };
  report: Report;
}): Promise<Buffer> {
  const { company, groupBy, period, report } = input;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'landscape', margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: { Title: `${company}: income ${period.from} to ${period.to}`, Author: company, Creator: 'Batoma' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    registerMukta(doc);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const money = (p: number | null | undefined) => (p == null ? '—' : formatPaisa(p, { symbol: false }));

    doc.rect(0, 0, doc.page.width, 6).fill(BRAND);
    mixed(doc, company, { bold: true, size: 17, x: left, y: 24, width, color: INK });
    mixed(doc, `Income by ${GROUP[groupBy][0].toLowerCase()} · ${GROUP[groupBy][1]} अनुसार आम्दानी`, { size: 11, color: DIM, width });
    mixed(doc, `${period.from} – ${period.to}  (${period.fromBs} – ${period.toBs} BS) · amounts in NPR`, { size: 10, color: DIM, width });

    // Totals
    const t = report.totals;
    const boxes: Array<[string, string]> = [
      ['Net income · खुद आम्दानी', money(t.netPaisa)],
      ['Tickets · टिकट', String(t.tickets)],
      ['Occupancy · सिट भराइ', t.occupancy == null ? '—' : `${Math.round(t.occupancy * 100)}%`],
      ['Net per km · प्रति किमी', money(t.revenuePerKmPaisa)],
      ['Operating profit · सञ्चालन नाफा', money(t.profitPaisa)],
    ];
    const bw = (width - 4 * 8) / 5;
    const by = doc.y + 10;
    boxes.forEach(([label, value], i) => {
      const x = left + i * (bw + 8);
      doc.roundedRect(x, by, bw, 46, 6).lineWidth(0.6).strokeColor(LINE).stroke();
      mixed(doc, label, { size: 8, color: DIM, x: x + 8, y: by + 6, width: bw - 16 });
      mixed(doc, value, { bold: true, size: 14, color: INK, x: x + 8, y: by + 20, width: bw - 16 });
    });
    doc.y = by + 58;

    // Table
    const cols: Array<[string, number, 'left' | 'right']> = groupBy === 'driver'
      ? [[GROUP[groupBy][0], 200, 'left'], ['Tickets', 60, 'right'], ['Trips', 50, 'right'], ['Occupancy', 70, 'right'], ['Km', 60, 'right'], ['Gross', 90, 'right'], ['Fees', 70, 'right'], ['Net', 90, 'right'], ['Net/km', 70, 'right']]
      : [[GROUP[groupBy][0], 150, 'left'], ['Tickets', 50, 'right'], ['Trips', 40, 'right'], ['Occ.', 45, 'right'], ['Km', 50, 'right'], ['Net', 80, 'right'], ['Fuel', 70, 'right'], ['Maint.', 65, 'right'], ['Repairs', 60, 'right'], ['Profit', 80, 'right'], ['Net/km', 55, 'right']];
    const scale = width / cols.reduce((n, c) => n + c[1], 0);
    const header = () => {
      let x = left;
      const y = doc.y;
      cols.forEach(([label, w, align]) => { mixed(doc, label, { bold: true, size: 8.5, color: DIM, x, y, width: w * scale - 4, align }); x += w * scale; });
      doc.y = y + 14;
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.y += 4;
    };
    header();
    const line = (values: string[], bold = false) => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) { doc.addPage(); header(); }
      let x = left;
      const y = doc.y;
      cols.forEach(([, w, align], i) => { mixed(doc, values[i] ?? '', { bold, size: 9, color: INK, x, y, width: w * scale - 4, align }); x += w * scale; });
      doc.y = y + 15;
    };
    const pct = (o: number | null) => (o == null ? '—' : `${Math.round(o * 100)}%`);
    for (const r of report.rows) {
      const name = r.detail ? `${r.label} · ${r.detail}` : r.label;
      line(groupBy === 'driver'
        ? [name, String(r.tickets), String(r.trips), pct(r.occupancy), String(r.km || '—'), money(r.grossPaisa), money(r.feesPaisa), money(r.netPaisa), money(r.revenuePerKmPaisa)]
        : [name, String(r.tickets), String(r.trips), pct(r.occupancy), String(r.km || '—'), money(r.netPaisa), money(r.costs?.fuelPaisa), money(r.costs?.maintenancePaisa), money(r.costs?.repairsPaisa), money(r.profitPaisa), money(r.revenuePerKmPaisa)]);
    }
    if (!report.rows.length) line(['No income recorded in this period']);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.y += 4;
    line(groupBy === 'driver'
      ? ['Total', String(t.tickets), String(t.trips), pct(t.occupancy), String(t.km || '—'), money(t.grossPaisa), money(t.feesPaisa), money(t.netPaisa), money(t.revenuePerKmPaisa)]
      : ['Total', String(t.tickets), String(t.trips), pct(t.occupancy), String(t.km || '—'), money(t.netPaisa), '', '', '', money(t.profitPaisa), money(t.revenuePerKmPaisa)], true);

    doc.y += 10;
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    mixed(doc, report.note, { size: 8.5, color: DIM, x: left, y: doc.y, width });
    if (groupBy === 'driver') {
      mixed(doc, 'Income is placed with a driver through the trip it was entered against; costs belong to buses, so there is no profit by driver.', { size: 8.5, color: DIM, width });
    }
    doc.end();
  });
}
