import { BadRequestException } from '@nestjs/common';
import { kathmanduDay } from './bs-date';

/** A Kathmandu calendar day, YYYY-MM-DD. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Midnight in Kathmandu (UTC+05:45 all year) as an instant. */
export const ktmDayStart = (day: string) => new Date(`${day}T00:00:00+05:45`);
/** A calendar day moved by `n` days. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const ktmToday = () => kathmanduDay(new Date());

export interface Period { fromDay: string; toDay: string; from: Date; to: Date }

/**
 * A period of Kathmandu days, both ends included, as the instants [from, to) that a query
 * filters on. Without dates: the last `defaultDays` days up to today. Refuses a period
 * that ends before it starts, ends in the future, or is longer than `maxDays`.
 */
export function kathmanduPeriod(fromDay?: string, toDay?: string, { defaultDays = 90, maxDays = 731 } = {}): Period {
  const today = ktmToday();
  const to = toDay ?? today;
  const from = fromDay ?? addDays(to, -(defaultDays - 1));
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || Number.isNaN(ktmDayStart(from).getTime()) || Number.isNaN(ktmDayStart(to).getTime())) {
    throw new BadRequestException('Dates must be written as YYYY-MM-DD.');
  }
  if (from > to) throw new BadRequestException('The period must end on or after the day it starts.');
  if (to > addDays(today, 1)) throw new BadRequestException("The period can't end in the future.");
  if ((Date.parse(to) - Date.parse(from)) / DAY_MS + 1 > maxDays) {
    throw new BadRequestException(`Choose a period of ${maxDays} days or less.`);
  }
  return { fromDay: from, toDay: to, from: ktmDayStart(from), to: ktmDayStart(addDays(to, 1)) };
}
