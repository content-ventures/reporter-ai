'use client';

import { useSyncExternalStore } from 'react';
import type { TemplateId } from '@/domain';

/**
 * The model this person last chose for a carousel, kept in this browser (a per-viewer
 * convenience: the next carousel starts from it). Every storage access is guarded; without
 * storage the library's first model is the start.
 */

const KEY = 'reporter:ui:last-template';
const listeners = new Set<() => void>();
let cached: string | null | undefined;

function read(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = window.localStorage.getItem(KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export function rememberTemplate(templateId: TemplateId): void {
  cached = templateId;
  try {
    window.localStorage.setItem(KEY, templateId);
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLastTemplate(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
