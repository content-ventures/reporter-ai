'use client';

import { useEffect, useEffectEvent } from 'react';
import type { RunId } from '../domain/ids.ts';
import type { RunListener, RunUpdate } from '../ports/generation.ts';
import type { QueryState } from './query-state.ts';
import { isTerminalUpdate } from './run-outcome.ts';
import type { RunState } from './run-store.ts';
import { useEntry } from './use-queries.ts';
import { useRuntime, useRuntimeHolderState } from './use-runtime.ts';

/**
 * Generation runs on screen. Runs live in the runtime, not in components: leaving a page never
 * cancels them, and `useRunOutcomes` lets the shell announce "Rascunho pronto · Abrir".
 */

/** Live snapshot of a run of this session: steps, finished blocks, partial text, `live`. */
export function useRun(runId: RunId | null | undefined): QueryState<RunState> {
  const state = useRuntimeHolderState();
  const entry = state.status === 'ready' && runId ? state.runs.entry(runId) : undefined;
  return useEntry(entry, state.status === 'error' ? state.error : undefined);
}

/** Every live update of a run (text deltas included); the listener may change between renders. */
export function useRunListener(runId: RunId | null | undefined, listener: RunListener): void {
  const state = useRuntimeHolderState();
  const entry = state.status === 'ready' && runId ? state.runs.entry(runId) : undefined;
  const onUpdate = useEffectEvent((update: RunUpdate) => listener(update));
  useEffect(() => entry?.listen((update) => onUpdate(update)), [entry]);
}

/** Runs of this session ending (completed, failed, cancelled), wherever they were started. */
export function useRunOutcomes(listener: (update: RunUpdate) => void): void {
  const { runtime } = useRuntime();
  const onOutcome = useEffectEvent((update: RunUpdate) => listener(update));
  useEffect(() => {
    if (!runtime) return undefined;
    return runtime.generation.watch((update) => {
      if (isTerminalUpdate(update)) onOutcome(update);
    });
  }, [runtime]);
}
