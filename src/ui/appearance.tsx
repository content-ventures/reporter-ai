'use client';
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { ThemeV3, type ThemeMode } from '@content-ventures/design-system/v3';
const KEY = 'reporter:appearance';
const Appearance = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({ mode: 'system', setMode() {} });
function subscribe(callback: () => void) { window.addEventListener('storage', callback); window.addEventListener('reporter-appearance', callback); return () => { window.removeEventListener('storage', callback); window.removeEventListener('reporter-appearance', callback); }; }
function snapshot(): ThemeMode { try { const value = localStorage.getItem(KEY); return value === 'dark' || value === 'light' ? value : 'system'; } catch { return 'system'; } }
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribe, snapshot, () => 'system' as ThemeMode);
  const setMode = (next: ThemeMode) => { try { localStorage.setItem(KEY, next); } catch {} window.dispatchEvent(new Event('reporter-appearance')); };
  return <Appearance.Provider value={{ mode, setMode }}><ThemeV3 mode={mode}>{children}</ThemeV3></Appearance.Provider>;
}
export const useAppearance = () => useContext(Appearance);
