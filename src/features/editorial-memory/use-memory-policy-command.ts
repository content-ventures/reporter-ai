'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { contentHash } from '@/domain/text/hash';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryLibrary } from '@/state/use-memory-library';

/** A retained form owns its account and idempotent attempt, including late command replies. */
export function useMemoryPolicyCommand(basis: MemoryLibrary, enabled: boolean) {
  const port = useMemoryLibrary(), bound = port === basis, live = useRef(false), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const attempt = useRef<{ signature: string; key: string }>(undefined);
  useLayoutEffect(() => { live.current = enabled && bound; return () => { live.current = false; }; }, [enabled, bound]);
  async function execute<T>(input: unknown, operation: (key: string) => Promise<T>, saved: (value: T) => void) {
    if (!live.current || pending.current) return;
    const signature = contentHash(input); if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError(undefined);
    try { const value = await operation(attempt.current.key); if (live.current) saved(value); }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a alteração.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return { bound, busy, error, execute };
}
