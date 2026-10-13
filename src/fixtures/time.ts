import type { IsoDateTime } from '../domain/index.ts';

/**
 * Fixture dates are offsets from the injected `now` (Clock port), so "há 2 h" always reads
 * coherently and tests use a fixed instant. Nothing here reads the system clock.
 */

export type Offset = { days?: number; hours?: number; minutes?: number; seconds?: number };

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function offsetMs(offset: Offset): number {
  return (
    (offset.days ?? 0) * DAY_MS + (offset.hours ?? 0) * HOUR_MS + (offset.minutes ?? 0) * MINUTE_MS + (offset.seconds ?? 0) * 1000
  );
}

/** The instant `offset` before `now`. */
export function ago(now: IsoDateTime, offset: Offset): IsoDateTime {
  return new Date(Date.parse(now) - offsetMs(offset)).toISOString();
}

/** The instant `offset` after `from`. */
export function after(from: IsoDateTime, offset: Offset): IsoDateTime {
  return new Date(Date.parse(from) + offsetMs(offset)).toISOString();
}

/** Calendar date (YYYY-MM-DD, UTC) of an instant. */
export function dateOf(instant: IsoDateTime): string {
  return instant.slice(0, 10);
}

export function assertValidNow(now: IsoDateTime): void {
  if (!Number.isFinite(Date.parse(now))) throw new Error(`Invalid fixture clock: ${now}`);
}
