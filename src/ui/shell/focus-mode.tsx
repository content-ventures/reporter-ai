'use client';

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Focus mode (PLAN §3.5): the shell menu turns into a drawer and the studio collapses its panes.
 * Studios read it with `useFocusMode()` and pass it to `WorkspaceLayout focus/onFocusChange`
 * (Esc leaves). It ends by itself when the route changes.
 */

export type FocusMode = {
  focus: boolean;
  setFocus: (focus: boolean) => void;
  toggle: () => void;
};

const FocusContext = createContext<FocusMode | null>(null);

export function FocusModeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<{ focus: boolean; path: string | null }>({ focus: false, path: pathname });
  // Leaving the page leaves focus mode (derived during render, no effect).
  const focus = state.focus && state.path === pathname;
  const setFocus = useCallback((next: boolean) => setState({ focus: next, path: pathname }), [pathname]);
  const toggle = useCallback(() => setState((previous) => ({ focus: !(previous.focus && previous.path === pathname), path: pathname })), [pathname]);
  const value = useMemo(() => ({ focus, setFocus, toggle }), [focus, setFocus, toggle]);
  return <FocusContext value={value}>{children}</FocusContext>;
}

const OUTSIDE: FocusMode = { focus: false, setFocus: () => undefined, toggle: () => undefined };

export function useFocusMode(): FocusMode {
  return use(FocusContext) ?? OUTSIDE;
}
