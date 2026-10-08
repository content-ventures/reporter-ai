/**
 * Calendar days of the period filters (Produções, Logs): `YYYY-MM-DD` in the person's time zone
 * and their short labels (contract §11). Plain functions, so node --test runs them.
 */

/** "05/10" (contract §11 interval parts). */
export function shortDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${date}/${month}`;
}

/** "05/10 – 31/10", "a partir de 05/10", "até 31/10". */
export function periodLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`;
  if (from) return `a partir de ${shortDay(from)}`;
  if (to) return `até ${shortDay(to)}`;
  return '';
}

/** Local calendar day `YYYY-MM-DD`, `days` before `now` (0 = today). */
export function localDay(now: Date, days = 0): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 12);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
