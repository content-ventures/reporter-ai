'use client';

import { createContext, Suspense, useEffect,useMemo, useState,useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { interV3 } from '@content-ventures/design-system/v3';
import { createConnectedRuntime } from '../runtime/create-connected-runtime.ts';
import { createRuntime } from '../runtime/create-runtime.ts';
import { createRuntimeHolder } from './runtime-holder.ts';
import type { RuntimeHolder } from './runtime-holder.ts';
import { workspaceAddress } from '../domain/workspace-address.ts';
import {WorkspaceAddressContext} from '../ui/workspace-navigation.ts';

/**
 * Root client provider: creates the runtime once per tab, after hydration (nothing reads
 * `window` or storage during render), and keeps it across navigations so runs keep streaming
 * when a page is left. `?reset=1` reopens the fixtures and is removed from the address bar.
 */

export const RuntimeContext = createContext<RuntimeHolder | null>(null);

const RESET_PARAM = 'reset';

/** The creatives' "Inter" is the DS face (registered under its own family name). */
const TYPEFACES = { Inter: interV3.style.fontFamily };
// Compiled only into the disposable fixture build used by the legacy UI regression suite. The
// release build never exposes the simulated workspace and always uses PostgreSQL-backed state.
const E2E_FIXTURES = process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES === 'true';
const noHydrationSubscription=()=>()=>{};
const hydrated=()=>true;
const serverHydrated=()=>false;

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

export function RuntimeProvider({children,initialWorkspaceSlug}:{children:ReactNode;initialWorkspaceSlug?:string}){
  return E2E_FIXTURES?<RuntimeBoundary>{children}</RuntimeBoundary>:<Suspense fallback={null}><AddressBoundary initialWorkspaceSlug={initialWorkspaceSlug}>{children}</AddressBoundary></Suspense>;
}
function AddressBoundary({children,initialWorkspaceSlug}:{children:ReactNode;initialWorkspaceSlug?:string}){
  const pathname=usePathname()??'';
  const mounted=useSyncExternalStore(noHydrationSubscription,hydrated,serverHydrated);
  const slug=mounted?workspaceAddress(pathname)?.slug??(pathname.startsWith('/w/')?'':undefined):initialWorkspaceSlug;
  return<RuntimeBoundary key={slug===undefined?'pilot':`workspace:${slug}`} workspaceSlug={slug}>{children}</RuntimeBoundary>;
}
function RuntimeBoundary({children,workspaceSlug}:{children:ReactNode;workspaceSlug?:string}){
  const address=useMemo(()=>({slug:workspaceSlug}),[workspaceSlug]);
  const [holder] = useState(() => createRuntimeHolder((options) => E2E_FIXTURES
    ? createRuntime({ ...options,typefaces: TYPEFACES })
    : createConnectedRuntime({ typefaces: TYPEFACES,workspaceSlug }),{releaseAfterMs:E2E_FIXTURES?1000:0}));

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
    <WorkspaceAddressContext value={address}><RuntimeContext value={holder}>
      {children}
      <Suspense fallback={null}>
        <FlushOnRouteChange holder={holder} />
      </Suspense>
    </RuntimeContext></WorkspaceAddressContext>
  );
}
