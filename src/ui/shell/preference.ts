'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Per-viewer UI conveniences kept in this browser (collapsed menu). Every storage access is
 * guarded: a private window or blocked storage just falls back to the default.
 */

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, boolean>();

function read(key: string, fallback: boolean): boolean {
  if (cache.has(key)) return cache.get(key) as boolean;
  let value = fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true' || raw === 'false') value = raw === 'true';
  } catch {
    // Storage unavailable: keep the default.
  }
  cache.set(key, value);
  return value;
}

function write(key: string, value: boolean): void {
  cache.set(key, value);
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
  for (const listener of [...(listeners.get(key) ?? [])]) listener();
}

export function usePersistentFlag(key: string, fallback = false): [boolean, (value: boolean) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => {
        set.delete(listener);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const setValue = useCallback((next: boolean) => write(key, next), [key]);
  return [value, setValue];
}
