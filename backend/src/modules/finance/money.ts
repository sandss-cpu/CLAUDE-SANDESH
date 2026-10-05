/**
 * Money is integer paisa everywhere it is stored or added up (100 paisa = 1 rupee), so a
 * month of fares never drifts by floating-point fractions. Rupees appear only at the edges:
 * what an owner types, what a portal export says, and what a report prints.
 */

/** NPR 10 crore: far above any single day's takings, well inside a 32-bit integer of paisa. */
export const MAX_ENTRY_PAISA = 1_000_000_000;

/**
 * Rupees as people and portal exports write them, to paisa: "1,234.50", "Rs. 1,234",
 * "NPR 12,34,567" (Indian grouping), "रु ५००", "(250)" for a negative. Returns null for
 * anything that is not a clean amount; never guesses.
 */
export function parseRupees(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  if (typeof raw !== 'string') return null;
  let text = raw.trim()
    .replace(/[०-९]/g, (d) => String('०१२३४५६७८९'.indexOf(d)))
    .replace(/^(npr|nrs\.?|rs\.?|रु\.?|रू\.?)\s*/i, '')
    .replace(/\s*(npr|nrs)$/i, '')
    .trim();
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (text.startsWith('-')) { negative = true; text = text.slice(1).trim(); }
  // Plain digits, or grouped Western (1,234,567) or Nepali/Indian (12,34,567) style, the
  // last group always three digits: "1,23" is refused rather than read as 123 rupees.
  if (!/^\d{1,3}(?:(?:,\d{2})*,\d{3}|(?:,\d{3})+)(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
  const paisa = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return negative ? -paisa : paisa;
}

/** "NPR 1,23,456.50" in the Nepali/Indian grouping owners read every day. */
export function formatPaisa(paisa: number, { symbol = true } = {}): string {
  const negative = paisa < 0;
  const abs = Math.abs(Math.round(paisa));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const digits = String(rupees);
  const last3 = digits.slice(-3);
  const others = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = others ? `${others},${last3}` : last3;
  const text = `${grouped}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
  return `${negative ? '-' : ''}${symbol ? 'NPR ' : ''}${text}`;
}

/** Rupees as a plain decimal for CSV export: "1234.50". */
export const paisaToDecimal = (paisa: number) => (paisa / 100).toFixed(2);
