import { bsToAd } from '../../../common/utils/bs-date';

export type DateOrder = 'DMY' | 'MDY' | 'YMD';
export type Calendar = 'AD' | 'BS';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const nepaliDigits = (s: string) => s.replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)));

/** A real AD calendar day, or null: 31 February is refused, never rolled into March. */
function adDay(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * A day as an export writes it, to YYYY-MM-DD in AD. Numeric dates follow `order`
 * (Nepal writes day first); a four-digit first part is always year first. "4 Oct 2026",
 * an ISO timestamp (its calendar day as written) and an Excel day already converted by
 * the XLSX reader are understood. With `calendar: 'BS'` the numbers are a Bikram Sambat
 * date and are converted; months by name are AD only.
 */
export function parseDay(raw: unknown, order: DateOrder = 'DMY', calendar: Calendar = 'AD'): string | null {
  if (raw == null) return null;
  const text = nepaliDigits(String(raw).trim());
  if (!text) return null;

  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/.exec(text) ?? /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (named && calendar === 'AD') {
    const [a, b, y] = named.slice(1);
    const [dayPart, monthName] = /^\d/.test(a) ? [a, b] : [b, a];
    const m = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
    return m ? adDay(Number(y), m, Number(dayPart)) : null;
  }

  const parts = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T\s].*)?$/.exec(text);
  if (!parts) return null;
  const [a, b, c] = parts.slice(1).map(Number);
  let y: number; let m: number; let d: number;
  if (parts[1].length === 4) [y, m, d] = [a, b, c];
  else if (parts[3].length === 4) {
    y = c;
    [d, m] = order === 'MDY' ? [b, a] : [a, b];
  } else return null;

  if (calendar === 'BS') return bsToAd(y, m, d);
  return adDay(y, m, d);
}

/** A count of tickets or seats: digits only, Nepali digits allowed. */
export function parseCount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? raw : null;
  const text = nepaliDigits(String(raw ?? '').trim()).replace(/,/g, '');
  if (!text) return null;
  return /^\d{1,6}$/.test(text) ? Number(text) : null;
}
