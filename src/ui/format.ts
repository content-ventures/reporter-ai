/**
 * pt-BR formats of the DS contract (§11) that the DS `format.ts` does not cover. Pure functions:
 * no `Intl` (server and browser agree) and no clock reads.
 */

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad = (value: number) => String(value).padStart(2, '0');

function parse(value: string | Date): Date | undefined {
  const date = value instanceof Date ? value : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "12 out" (with the year when it differs from `now`: "12 out 2025"). */
export function formatShortDate(value: string | Date, now: Date = new Date()): string {
  const date = parse(value);
  if (!date) return '—';
  const short = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? short : `${short} ${date.getFullYear()}`;
}

/** "05/10/2026". */
export function formatDate(value: string | Date): string {
  const date = parse(value);
  if (!date) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** "29/09/2026 às 16:42". */
export function formatDateTime(value: string | Date): string {
  const date = parse(value);
  if (!date) return '—';
  return `${formatDate(date)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "22/10 · 16:25" (list rows). Non-breaking around the dot: a wrapped line never leaves the time alone. */
export function formatListDateTime(value: string | Date): string {
  const date = parse(value);
  if (!date) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}\u00a0·\u00a0${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Durations of runs and stages: "800 ms", "4 s", "2 min 05 s", "1 h 12 min". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${pad(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}

/** Integer with pt-BR thousands: "4.548". */
export function formatCount(count: number): string {
  const sign = count < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(count))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1 falante", "3 falantes", "4.548 palavras". */
export function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
