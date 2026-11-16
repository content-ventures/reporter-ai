'use client';
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ThemeV3, type ThemeMode } from '@content-ventures/design-system/v3';
import { APPEARANCE_COOKIE, APPEARANCE_STORAGE, appearanceMode } from './appearance-preference';

const Appearance = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: 'system', setMode() {} });
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('reporter-appearance', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('reporter-appearance', callback);
  };
}
function snapshot(fallback: ThemeMode): ThemeMode {
  try {
    const cookie = document.cookie.split('; ').find(value => value.startsWith(`${APPEARANCE_COOKIE}=`));
    const saved = appearanceMode(cookie?.slice(APPEARANCE_COOKIE.length + 1));
    if (saved) return saved;
  } catch {}
  try { return appearanceMode(localStorage.getItem(APPEARANCE_STORAGE)) ?? fallback; } catch { return fallback; }
}
function persist(mode: ThemeMode) {
  try { localStorage.setItem(APPEARANCE_STORAGE, mode); } catch {}
  try { document.cookie = `${APPEARANCE_COOKIE}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch {}
}
export function AppearanceProvider({ children, initialMode = 'system' }: { children: ReactNode; initialMode?: ThemeMode }) {
  const getSnapshot = useCallback(() => snapshot(initialMode), [initialMode]);
  const mode = useSyncExternalStore(subscribe, getSnapshot, () => initialMode);
  // Migrate the previous browser preference without replacing it with the server fallback.
  useEffect(() => { persist(getSnapshot()); }, [getSnapshot]);
  const setMode = (next: ThemeMode) => {
    persist(next);
    window.dispatchEvent(new Event('reporter-appearance'));
  };
  return <Appearance.Provider value={{ mode, setMode }}><ThemeV3 mode={mode}>{children}</ThemeV3></Appearance.Provider>;
}
export const useAppearance = () => useContext(Appearance);
