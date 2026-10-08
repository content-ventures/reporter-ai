'use client';

import { createContext, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { interV3 } from '@content-ventures/design-system/v3';
import { createRuntime } from '../runtime/create-runtime.ts';
import { createRuntimeHolder } from './runtime-holder.ts';
import type { RuntimeHolder } from './runtime-holder.ts';

/**
 * Root client provider: creates the runtime once per tab, after hydration (nothing reads
 * `window` or storage during render), and keeps it across navigations so runs keep streaming
 * when a page is left. `?reset=1` reopens the fixtures and is removed from the address bar.
 */

export const RuntimeContext = createContext<RuntimeHolder | null>(null);

const RESET_PARAM = 'reset';

/** The creatives' "Inter" is the DS face (registered under its own family name). */
const TYPEFACES = { Inter: interV3.style.fontFamily };

/** Reads and removes `?reset=1` (client only). */
function consumeResetParam(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(RESET_PARAM) !== '1') return false;
  url.searchParams.delete(RESET_PARAM);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}

/** Writes coalesced changes when the route changes (in Suspense: the pathname may suspend). */
function FlushOnRouteChange({ holder }: { holder: RuntimeHolder }) {
  const pathname = usePathname();
  useEffect(() => () => holder.flush(), [holder, pathname]);
  return null;
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [holder] = useState(() => createRuntimeHolder(({ reset, empty }) => createRuntime({ reset, empty, typefaces: TYPEFACES })));

  useEffect(() => {
    holder.start({ reset: consumeResetParam() });
    const flush = () => holder.flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') holder.flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      holder.release();
    };
  }, [holder]);

  return (
    <RuntimeContext value={holder}>
      {children}
      <Suspense fallback={null}>
        <FlushOnRouteChange holder={holder} />
      </Suspense>
    </RuntimeContext>
  );
}
