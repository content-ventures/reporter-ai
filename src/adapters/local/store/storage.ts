import type { SaveErrorCode } from '../../../ports/save-status.ts';

/**
 * Key-value storage the store persists to. `localStorage` in the browser; an in-memory map in
 * tests (with an optional byte quota to exercise the "cota cheia" path).
 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class StorageQuotaError extends Error {
  readonly name = 'QuotaExceededError';
}

/** In-memory storage. `quotaBytes` approximates the browser limit (UTF-16: 2 bytes per char). */
export function memoryStorage(options: { quotaBytes?: number } = {}): KeyValueStorage & { entries(): Map<string, string>; setQuota(bytes?: number): void } {
  const map = new Map<string, string>();
  let quota = options.quotaBytes;
  const size = () => [...map.entries()].reduce((total, [key, value]) => total + (key.length + value.length) * 2, 0);
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (quota !== undefined) {
        const previous = map.get(key);
        const next = size() - (previous === undefined ? 0 : (key.length + previous.length) * 2) + (key.length + value.length) * 2;
        if (next > quota) throw new StorageQuotaError('Storage quota exceeded');
      }
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    entries: () => map,
    setQuota: (bytes) => {
      quota = bytes;
    },
  };
}

/**
 * The browser's localStorage, or `undefined` when unavailable (SSR, blocked site data, some
 * private modes throw on access). Never throws.
 */
export function browserLocalStorage(): KeyValueStorage | undefined {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!candidate) return undefined;
    const probe = 'reporter:sim:probe';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return undefined;
  }
}

/** Classifies a storage write error for the SaveState shown to the person. */
export function storageErrorCode(error: unknown): SaveErrorCode {
  if (error && typeof error === 'object') {
    const { name, code } = error as { name?: string; code?: number };
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) return 'quota';
    if (name === 'SecurityError') return 'unavailable';
  }
  return 'unknown';
}

export const SAVE_ERROR_MESSAGES: Record<SaveErrorCode, string> = {
  quota: 'O espaço deste navegador acabou. Suas alterações seguem nesta aba; libere espaço e tente de novo.',
  unavailable: 'Este navegador não permite salvar localmente. As alterações valem só nesta aba.',
  unknown: 'Não foi possível salvar neste navegador. Tente de novo.',
};
