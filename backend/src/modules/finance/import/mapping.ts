import { parseRupees, MAX_ENTRY_PAISA } from '../money';
import { Calendar, DateOrder, parseCount, parseDay } from './values';

/** The fields an income row can be built from. */
export const FIELDS = ['date', 'reference', 'gross', 'fees', 'net', 'tickets', 'seats', 'plate', 'note'] as const;
export type Field = typeof FIELDS[number];

/**
 * How one source's export maps onto income rows. Columns are named by their header text,
 * not their position, so a portal that reorders its columns does not break a saved mapping.
 */
export interface ImportMapping {
  columns: Partial<Record<Field, string>>;
  dateOrder: DateOrder;
  calendar: Calendar;
  /** For a file with no bus column: every row belongs to this bus. */
  vehicleId?: string | null;
}

/**
 * A booking portal's export format. Only the generic one exists today: Bussewa, eSewa
 * and Khalti publish no API, and their exports vary by account. An integration added later
 * implements this, recognising its own header row and proposing its own mapping.
 */
export interface IncomeImportAdapter {
  id: string;
  label: string;
  /** How sure this adapter is that the header row is its format, from 0 to 1. */
  recognise(headers: string[]): number;
  suggest(headers: string[]): Partial<ImportMapping>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

/** Header words each field is usually written with, in English and Nepali. Earlier patterns win. */
const GUESSES: Record<Field, RegExp[]> = {
  date: [/^(travel |journey |trip |transaction |txn |settlement |booking )?date$/, /\bdate\b/, /मिति/],
  reference: [/\b(booking|ticket|transaction|txn|settlement|order|invoice|receipt|pnr) ?(id|no|number|ref|reference)?\b/, /\breference\b|\bref\b/, /\bid\b/],
  gross: [/^(gross|total|fare|amount|gross amount|total amount|ticket amount|sales)$/, /\b(gross|total|fare)\b/, /\bamount\b/, /रकम|भाडा/],
  fees: [/\b(fee|fees|commission|charge|charges|service charge|mdr)\b/, /शुल्क|कमिसन/],
  net: [/\b(net|settled|payable|settlement amount|net amount)\b/],
  tickets: [/\b(tickets?|pax|passengers?|qty|quantity|no of tickets)\b/, /टिकट|यात्रु/],
  seats: [/\bseats?\b/, /सिट/],
  plate: [/\b(bus|vehicle|plate|registration|reg) ?(no|number)?\b/, /बस|गाडी/],
  note: [/\b(note|notes|remarks?|description|route)\b/, /कैफियत/],
};

export const genericAdapter: IncomeImportAdapter = {
  id: 'generic',
  label: 'Any spreadsheet (choose the columns)',
  recognise: () => 0.1,
  suggest(headers) {
    const columns: Partial<Record<Field, string>> = {};
    const taken = new Set<string>();
    for (const field of FIELDS) {
      for (const pattern of GUESSES[field]) {
        const hit = headers.find((h) => !taken.has(h) && pattern.test(norm(h)));
        if (hit) { columns[field] = hit; taken.add(hit); break; }
      }
    }
    return { columns, dateOrder: 'DMY', calendar: 'AD' };
  },
};

export const ADAPTERS: IncomeImportAdapter[] = [genericAdapter];

export function adapterFor(headers: string[]): IncomeImportAdapter {
  return [...ADAPTERS].sort((a, b) => b.recognise(headers) - a.recognise(headers))[0];
}

export interface ImportRow {
  /** The line in the file, counting the header as line 1, as a spreadsheet shows it. */
  line: number;
  date: string | null;
  reference: string | null;
  grossPaisa: number | null;
  feesPaisa: number;
  netPaisa: number | null;
  tickets: number;
  seats: number | null;
  plate: string | null;
  note: string | null;
  errors: string[];
  duplicateInFile: boolean;
}

/**
 * Turns the data rows under a header into income rows, checking each one. Amounts: gross
 * and fees give net; net and fees give gross; net alone is taken as gross with no fees.
 * A reference seen earlier in the same file marks the later row as a duplicate.
 */
export function mapRows(table: string[][], mapping: ImportMapping): { headers: string[]; rows: ImportRow[]; missing: Field[] } {
  const [headerRow = [], ...data] = table;
  const headers = headerRow.map((h) => h.trim());
  const index = (field: Field) => {
    const name = mapping.columns[field];
    if (!name) return -1;
    return headers.findIndex((h) => h.toLowerCase() === name.trim().toLowerCase());
  };
  const at = Object.fromEntries(FIELDS.map((f) => [f, index(f)])) as Record<Field, number>;
  const missing: Field[] = [];
  if (at.date < 0) missing.push('date');
  if (at.gross < 0 && at.net < 0) missing.push('gross');
  if (at.plate < 0 && !mapping.vehicleId) missing.push('plate');

  const seen = new Set<string>();
  const rows = data.map((cells, i): ImportRow => {
    const cell = (f: Field) => (at[f] >= 0 ? (cells[at[f]] ?? '').trim() : '');
    const errors: string[] = [];
    const date = parseDay(cell('date'), mapping.dateOrder, mapping.calendar);
    if (!date) errors.push(cell('date') ? `“${cell('date')}” is not a date` : 'No date');

    const gross = at.gross >= 0 && cell('gross') ? parseRupees(cell('gross')) : null;
    const fees = at.fees >= 0 && cell('fees') ? parseRupees(cell('fees')) : 0;
    const net = at.net >= 0 && cell('net') ? parseRupees(cell('net')) : null;
    if (at.gross >= 0 && cell('gross') && gross == null) errors.push(`“${cell('gross')}” is not an amount`);
    if (fees == null) errors.push(`“${cell('fees')}” is not an amount`);
    if (at.net >= 0 && cell('net') && net == null) errors.push(`“${cell('net')}” is not an amount`);
    let grossPaisa = gross;
    const feesPaisa = fees ?? 0;
    if (grossPaisa == null && net != null) grossPaisa = net + feesPaisa;
    let netPaisa = grossPaisa != null ? grossPaisa - feesPaisa : null;
    if (grossPaisa != null && net != null && gross != null && net !== netPaisa) {
      errors.push('Net does not equal gross less fees');
      netPaisa = null;
    }
    if (grossPaisa == null && !errors.some((e) => e.includes('amount'))) errors.push('No amount');
    if (grossPaisa != null && grossPaisa < 0) errors.push('Refunds and negative amounts are not imported; enter them by hand');
    if (feesPaisa < 0) errors.push('Fees cannot be negative');
    if (grossPaisa != null && feesPaisa > grossPaisa) errors.push('Fees are larger than the amount');
    if (grossPaisa != null && grossPaisa > MAX_ENTRY_PAISA) errors.push('Amount is too large for one row');

    const ticketsRaw = cell('tickets');
    const tickets = ticketsRaw ? parseCount(ticketsRaw) : 0;
    if (tickets == null) errors.push(`“${ticketsRaw}” is not a number of tickets`);
    const seatsRaw = cell('seats');
    const seats = seatsRaw ? parseCount(seatsRaw) : null;
    if (seatsRaw && seats == null) errors.push(`“${seatsRaw}” is not a number of seats`);

    const reference = cell('reference').slice(0, 120) || null;
    const duplicateInFile = !!reference && seen.has(reference);
    if (reference) seen.add(reference);
    const plate = cell('plate') || null;
    if (!plate && !mapping.vehicleId) errors.push('No bus');

    return {
      line: i + 2, date, reference, grossPaisa, feesPaisa, netPaisa,
      tickets: tickets ?? 0, seats, plate, note: cell('note').slice(0, 500) || null, errors, duplicateInFile,
    };
  });
  return { headers, rows, missing };
}
