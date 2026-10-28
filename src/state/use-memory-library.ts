'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemoryLibrary } from '../ports/editorial-memory.ts';
import { useRuntime } from './use-runtime.ts';

/** Results belong to one port and query; late responses cannot cross an account or filter change. */
export function useMemoryResource<T>(load: (library: MemoryLibrary) => Promise<T>, pollMs = 0, enabled = true) {
  const port = useRuntime().runtime?.memory;
  const [epoch, setEpoch] = useState(0);
  const activity = useMemo(() => ({ enabled }), [enabled]);
  const binding = useMemo(() => ({ port, load, epoch, activity }), [port, load, epoch, activity]);
  const [result, setResult] = useState<{ binding: typeof binding; value?: T; error?: string }>();
  const reload = useCallback(() => setEpoch(value => value + 1), []);
  useEffect(() => {
    const { port, load, activity } = binding;
    if (!port || !activity.enabled) return;
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try { const value = await load(port); if (live) setResult({ binding, value }); }
      catch (error) { if (live) setResult({ binding, error: error instanceof Error ? error.message : 'Não foi possível carregar.' }); }
      if (live && pollMs) timer = setTimeout(() => void read(), pollMs);
    };
    void read();
    return () => { live = false; clearTimeout(timer); };
  }, [binding, pollMs]);
  const current = result?.binding.port === port && result?.binding.load === load
    && (!enabled || result?.binding.activity === activity) ? result : undefined;
  return { port, data: current?.value, error: current?.error, reload };
}
