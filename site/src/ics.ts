import { kathmanduDay } from './format';

/**
 * One event as an iCalendar file (RFC 5545), for "Add to your calendar": a plain link,
 * so it works with no script on the page. Timed events are given in UTC; an all-day event
 * covers whole days, as Kathmandu counts them.
 */
export interface IcsEvent {
  id: string; title: string; summary: string; url: string; city: string; venue: string | null; address: string | null;
  startsAt: Date; endsAt: Date | null; allDay: boolean; cancelled: boolean;
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const date = (d: Date) => kathmanduDay(d).replace(/-/g, '');
const nextDay = (d: Date) => date(new Date(d.getTime() + 86_400_000));
/** Text values escape backslashes, semicolons, commas and new lines. */
export const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes are folded: the rest goes on following lines that start with a space. */
export function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Never cut through a multi-byte character (Devanagari is three bytes a letter).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // the leading space counts
  }
  return out.join('\r\n ');
}

export function icsFile(e: IcsEvent, host: string, now = new Date()): string {
  const where = [e.venue, e.address, e.city].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Batoma//Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.id}@${host}`,
    `DTSTAMP:${stamp(now)}`,
    ...(e.allDay
      ? [`DTSTART;VALUE=DATE:${date(e.startsAt)}`, `DTEND;VALUE=DATE:${nextDay(e.endsAt ?? e.startsAt)}`]
      : [`DTSTART:${stamp(e.startsAt)}`, ...(e.endsAt ? [`DTEND:${stamp(e.endsAt)}`] : [])]),
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(`${e.summary}\n\n${e.url}`)}`,
    ...(where ? [`LOCATION:${icsText(where)}`] : []),
    `URL:${e.url}`,
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
