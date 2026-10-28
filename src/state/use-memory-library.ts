'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MemoryLibrary } from '../ports/editorial-memory.ts';
import { useRuntime } from './use-runtime.ts';

/** Results belong to one port and query; late responses cannot cross an account or filter change. */
export function useMemoryResource<T>(load: (library: MemoryLibrary) => Promise<T>, pollMs = 0) {
  const port = useRuntime().runtime?.memory;
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{ port: MemoryLibrary; load: typeof load; value?: T; error?: string }>();
  const reload = useCallback(() => setEpoch(value => value + 1), []);
  useEffect(() => {
    if (!port) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try { const value = await load(port); if (live) setResult({ port, load, value }); }
      catch (error) { if (live) setResult({ port, load, error: error instanceof Error ? error.message : 'Não foi possível carregar.' }); }
      if (live && pollMs) timer = setTimeout(() => void read(), pollMs);
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [port, load, pollMs, epoch]);
  const current = result?.port === port && result?.load === load ? result : undefined;
  return { port, data: current?.value, error: current?.error, reload };
}
