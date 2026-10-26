'use client';

import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import type { PlatformRefusal } from '../domain/platform.ts';
import type { UsagePeriod, UsageReport } from '../domain/platform-usage.ts';
import type { Result } from '../domain/result.ts';
import type { DirectorySearch,PlatformFilter,InviteDesk, PlatformConsole, PlatformDirectory, PlatformLogPage, PlatformOperator } from '../ports/platform.ts';
import { createPlatformRuntime, type PlatformRuntime } from '../runtime/create-platform.ts';

/**
 * The platform console's state: its own small runtime (never the editorial workspace), the
 * queries the console screens read, and the invite desk of the link page. Every write of the
 * console refreshes what is on screen.
 */

const PlatformContext = createContext<PlatformRuntime | null>(null);

// Compiled only into the fixture build; every release build talks to the server.
const DEMO = process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES === 'true';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => createPlatformRuntime({ demo: DEMO, storage: browserStorage() }));
  return <PlatformContext value={runtime}>{children}</PlatformContext>;
}

function usePlatformRuntime(): PlatformRuntime {
  const runtime = use(PlatformContext);
  if (!runtime) throw new Error('PlatformProvider is missing');
  return runtime;
}

export function usePlatform(): PlatformConsole {
  return usePlatformRuntime().console;
}

export function useInviteDesk(): InviteDesk {
  return usePlatformRuntime().invites;
}

export type PlatformQuery<T> = {
  status: 'loading' | 'ready' | 'error';
  data?: T;
  error?: { code: PlatformRefusal; message: string };
  /** Reading again after an answer (a write, a new period): the previous data stays on screen. */
  refreshing: boolean;
  retry: () => void;
};

type Answer<T> = { key: string; result: Result<T, PlatformRefusal> };

/** One read of the console, keyed; it reloads after every write and on `retry`. */
function usePlatformQuery<T>(key: string, load: (platform: PlatformConsole) => Promise<Result<T, PlatformRefusal>>): PlatformQuery<T> {
  const platform = usePlatform();
  const [version, setVersion] = useState(0);
  const [answer, setAnswer] = useState<Answer<T> & { version: number }>();
  const [keptAnswer, setKept] = useState<{key:string;value:T}>();
  const kept=keptAnswer?.key===key?keptAnswer.value:undefined;

  useEffect(() => platform.subscribe(() => setVersion((current) => current + 1)), [platform]);

  useEffect(() => {
    let live = true;
    void load(platform).then((result) => {
      if (!live) return;
      setAnswer({ key, result, version });
      if (result.ok) setKept({key,value:result.value});
    });
    return () => { live = false; };
    // `load` is recreated on every render; `key` names what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, key, version]);

  const retry = () => setVersion((current) => current + 1);
  const current = answer && answer.key === key && answer.version === version ? answer.result : undefined;
  if (!current) return { status: kept === undefined ? 'loading' : 'ready', data: kept, refreshing: kept !== undefined, retry };
  if (!current.ok) return { status: 'error', error: current.refusal, data: kept, refreshing: false, retry };
  return { status: 'ready', data: current.value, refreshing: false, retry };
}

export function usePlatformOperator(): PlatformQuery<PlatformOperator> {
  return usePlatformQuery('operator', (platform) => platform.operator());
}

export function usePlatformDirectory(options?:DirectorySearch): PlatformQuery<PlatformDirectory> {
  return usePlatformQuery(`directory:${JSON.stringify(options)}`, (platform) => platform.directory(options));
}

export function usePlatformUsage(period: UsagePeriod,filter?:PlatformFilter): PlatformQuery<UsageReport> {
  return usePlatformQuery(`usage:${period}:${JSON.stringify(filter)}`, (platform) => platform.usage(period,filter));
}

export function usePlatformLog(limit: number,options?:PlatformFilter&{offset?:number}): PlatformQuery<PlatformLogPage> {
  return usePlatformQuery(`log:${limit}:${JSON.stringify(options)}`, (platform) => platform.log(limit,options));
}
export function usePlatformAdministration(){return usePlatformRuntime().workspaces;}
