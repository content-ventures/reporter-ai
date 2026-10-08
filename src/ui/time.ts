'use client';

import { useSyncExternalStore } from 'react';
import { formatRelative } from '@content-ventures/design-system/v3';

/**
 * A shared minute clock for relative times ("há 2 h"). One interval for the whole page, started
 * by the first subscriber. The server snapshot is `0`: relative text only appears after
 * hydration, which is when the runtime data exists anyway.
 */

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of [...listeners]) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot() {
  if (current === 0) current = Date.now();
  return current;
}

const getServerSnapshot = () => 0;

/** Current time, refreshed every 30 s; `undefined` during the server render. */
export function useNow(): Date | undefined {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return now === 0 ? undefined : new Date(now);
}

/** "agora", "há 2 min", "há 2 h", "ontem", "12 out" (DS `formatRelative`); "" before hydration. */
export function useRelativeTime(at: string | Date | undefined | null): string {
  const now = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!at || now === 0) return '';
  return formatRelative(at, new Date(now));
}

/** Inline relative time, for slots that take a ReactNode (meta, trailing). */
export function RelativeTime({ at }: { at: string | Date | undefined | null }) {
  return useRelativeTime(at);
}
