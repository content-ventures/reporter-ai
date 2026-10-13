/**
 * Pure formatting for Início (pt-BR, DS contract §11): the week window and durations. No React,
 * no clock reads: every function takes the data it formats, so `node --test` covers it.
 */

export type OverviewRangeKey = '7d' | '30d';

/** "Período" of the week line (COPY §1.2). */
export const RANGE_OPTIONS: { value: OverviewRangeKey; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

/** `?range=30d` → `30d`; anything else is the default 7-day window. */
export function parseRange(value: string | null | undefined): OverviewRangeKey {
  return value === '30d' ? '30d' : '7d';
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "4,1", "77,5": fixed decimals with a pt-BR comma, never "-0,0". */
export function decimal(value: number, digits = 1): string {
  const fixed = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return fixed.toFixed(digits).replace('.', ',');
}

/** A duration as a figure: `{ value: '4,1', unit: 'h' }` or `{ value: '58', unit: 'min' }`. */
export function durationFigure(ms: number): { value: string; unit: string } {
  if (ms < HOUR) return { value: String(Math.max(1, Math.round(ms / MINUTE))), unit: 'min' };
  return { value: decimal(ms / HOUR), unit: 'h' };
}

/** "4,1 h", "58 min". */
export function durationText(ms: number): string {
  const figure = durationFigure(ms);
  return `${figure.value} ${figure.unit}`;
}
