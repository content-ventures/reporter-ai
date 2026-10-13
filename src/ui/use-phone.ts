'use client';

import { useSyncExternalStore } from 'react';

/** Phone width (contract breakpoint 760); the server renders the wide arrangement. */
const PHONE = '(max-width: 760px)';

function subscribe(onChange: () => void) {
  const list = window.matchMedia(PHONE);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
}
