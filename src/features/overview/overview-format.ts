/**
 * Pure formatting for "Visão geral" (pt-BR, DS contract §11): metric figures, deltas with their
 * reading for screen readers, chart axis labels and the live-run excerpt. No React, no clock
 * reads: every function takes the data it formats, so `node --test` covers it.
 */

export type OverviewRangeKey = '7d' | '30d';

export const RANGE_OPTIONS: { value: OverviewRangeKey; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
];

export const RANGE_DAYS: Record<OverviewRangeKey, number> = { '7d': 7, '30d': 30 };

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

/** A duration as a KPI figure: `{ value: '4,1', unit: 'h' }` or `{ value: '58', unit: 'min' }`. */
export function durationFigure(ms: number): { value: string; unit: string } {
  if (ms < HOUR) return { value: String(Math.max(1, Math.round(ms / MINUTE))), unit: 'min' };
  return { value: decimal(ms / HOUR), unit: 'h' };
}

/** "4,1 h", "58 min". */
export function durationText(ms: number): string {
  const figure = durationFigure(ms);
  return `${figure.value} ${figure.unit}`;
}

/** 0.7747 → "77,5" (the "%" goes in the Metric unit). */
export function percentFigure(ratio: number): string {
  return decimal(ratio * 100);
}

export type Trend = 'better' | 'worse' | 'flat' | 'unknown';

/** Same shape as the DS `MetricDelta`, kept local so this module stays framework-free. */
export type DeltaFigure = {
  value: string;
  trend: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'flat';
  label: string;
};

const TONES: Record<Exclude<Trend, 'unknown'>, DeltaFigure['tone']> = { better: 'good', worse: 'bad', flat: 'flat' };

function direction(delta: number): DeltaFigure['trend'] {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
}

/** "nos 7 dias anteriores". */
export function previousWindow(days: number): string {
  return `nos ${days} dias anteriores`;
}

/** Approvals: "1" ↓ (bad), read as "1 a menos que nos 7 dias anteriores". */
export function countDelta(delta: number | null, trend: Trend, days: number): DeltaFigure | undefined {
  if (delta === null || trend === 'unknown') return undefined;
  const amount = Math.abs(Math.round(delta));
  const reading = delta === 0 ? `Igual ${previousWindow(days)}` : `${amount} a ${delta > 0 ? 'mais' : 'menos'} que ${previousWindow(days)}`;
  return { value: String(amount), trend: direction(delta), tone: TONES[trend], label: reading };
}

/** Time to approval: "58 min" ↓ (good when it falls), read as "58 min mais rápido…". */
export function durationDelta(deltaMs: number | null, trend: Trend, days: number): DeltaFigure | undefined {
  if (deltaMs === null || trend === 'unknown') return undefined;
  const amount = deltaMs === 0 ? '0 min' : durationText(Math.abs(deltaMs));
  const reading = deltaMs === 0 ? `Igual ${previousWindow(days)}` : `${amount} mais ${deltaMs < 0 ? 'rápido' : 'lento'} que ${previousWindow(days)}`;
  return { value: amount, trend: direction(deltaMs), tone: TONES[trend], label: reading };
}

/** Share of AI words kept: "0,3 p.p." ↓, read as "0,3 p.p. abaixo dos 7 dias anteriores". */
export function pointsDelta(deltaRatio: number | null, trend: Trend, days: number): DeltaFigure | undefined {
  if (deltaRatio === null || trend === 'unknown') return undefined;
  const points = deltaRatio * 100;
  const shown = decimal(Math.abs(points));
  const flat = shown === '0,0';
  const reading = flat
    ? `Igual ${previousWindow(days)}`
    : `${shown} p.p. ${points > 0 ? 'acima' : 'abaixo'} dos ${days} dias anteriores`;
  return {
    value: `${shown} p.p.`,
    trend: flat ? 'flat' : direction(points),
    tone: flat ? 'flat' : TONES[trend],
    label: reading,
  };
}

/**
 * A KPI sparkline from the metric's daily trend (oldest first, `null` where the trailing window
 * had no sample): gaps are skipped and fewer than two points draw nothing. The label is the
 * screen-reader reading, "De 12 para 14 nos últimos 7 dias".
 */
export function sparklineOf(
  series: readonly (number | null)[] | undefined,
  days: number,
  text: (value: number) => string,
): { points: number[]; label: string } | undefined {
  const points = (series ?? []).filter((value): value is number => value !== null && Number.isFinite(value));
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || first === undefined || last === undefined) return undefined;
  return { points, label: `De ${text(first)} para ${text(last)} nos últimos ${days} dias` };
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const pad = (value: number) => String(value).padStart(2, '0');

/** Axis labels of the rhythm, oldest day first: the last day is "Hoje". */
export function rhythmLabels(days: readonly { dayEnd: string }[], range: OverviewRangeKey): string[] {
  return days.map((day, index) => (index === days.length - 1 ? 'Hoje' : dayLabel(day.dayEnd, range)));
}

/** Axis label of a rhythm day: weekday in the 7-day window ("qua"), "07/10" in the 30-day one. */
export function dayLabel(iso: string, range: OverviewRangeKey): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return range === '7d' ? (WEEKDAYS_SHORT[date.getDay()] ?? '—') : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** Tooltip title of a rhythm day: "07/10 · quarta". */
export function dayTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} · ${WEEKDAYS[date.getDay()] ?? ''}`;
}

/** Round x-axis marks for the 30-day window: every 7th day counted back from today. */
export function weeklyTicks(length: number): number[] | undefined {
  if (length <= 7) return undefined;
  const ticks: number[] = [];
  for (let index = length - 1; index >= 0; index -= 7) ticks.unshift(index);
  return ticks;
}

/** Axis marks: integers as they are, fractional marks with a pt-BR comma ("2,5"). */
export function axisNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : decimal(value);
}

/**
 * The newest words of a text being written, for a live excerpt: the last `max` characters cut
 * at a word boundary and opened with "…". Short texts come back whole.
 */
export function liveExcerpt(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const tail = clean.slice(-max);
  const space = tail.indexOf(' ');
  return `…${space > 0 && space < max / 3 ? tail.slice(space + 1) : tail}`;
}
