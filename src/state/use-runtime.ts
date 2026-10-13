'use client';

import { use, useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SaveState } from '../ports/save-status.ts';
import type { SimulationScenario } from '../ports/generation.ts';
import type { Runtime, SimulationInfo } from '../runtime/runtime.ts';
import { createCommands } from './commands.ts';
import type { Commands } from './commands.ts';
import type { QueryError } from './query-state.ts';
import { IDLE } from './runtime-holder.ts';
import type { RuntimeHolder, RuntimeHolderState } from './runtime-holder.ts';
import { RuntimeContext } from './runtime-provider.tsx';

/** Runtime access for hooks and the few screens that need it directly. */

export function useRuntimeHolder(): RuntimeHolder {
  const holder = use(RuntimeContext);
  if (!holder) throw new Error('RuntimeProvider is missing above this component.');
  return holder;
}

const getIdle = (): RuntimeHolderState => IDLE;

/** Holder state; `idle` during the server render and until the client runtime exists. */
export function useRuntimeHolderState(): RuntimeHolderState {
  const holder = useRuntimeHolder();
  return useSyncExternalStore(holder.subscribe, holder.get, getIdle);
}

export type RuntimeStatus =
  | { status: 'loading'; runtime: undefined; error: undefined }
  | { status: 'ready'; runtime: Runtime; error: undefined }
  | { status: 'error'; runtime: undefined; error: QueryError };

const RUNTIME_LOADING: RuntimeStatus = Object.freeze({ status: 'loading', runtime: undefined, error: undefined });

/**
 * The runtime itself, for synchronous port reads (`render.measure`, `ingest.limits`,
 * `generation.scenarios()`). Data belongs in the query hooks; actions in `useCommands`.
 */
export function useRuntime(): RuntimeStatus {
  const state = useRuntimeHolderState();
  return useMemo<RuntimeStatus>(() => {
    if (state.status === 'ready') return { status: 'ready', runtime: state.runtime, error: undefined };
    if (state.status === 'error') return { status: 'error', runtime: undefined, error: state.error };
    return RUNTIME_LOADING;
  }, [state]);
}

/** Stable command groups; callable before the runtime is ready (they wait for it). */
export function useCommands(): Commands {
  const holder = useRuntimeHolder();
  return useMemo(() => createCommands(() => holder.whenReady()), [holder]);
}

export type SimulationControls = {
  /** True when the workspace is the local simulation ("Simulação local"). */
  available: boolean;
  info: SimulationInfo | undefined;
  /** ⌘K "Simulação" group: failure and pause scenarios for generation. */
  scenarios: readonly SimulationScenario[];
  /** "Restaurar exemplo": reopens the fixtures (same as `?reset=1`). */
  reset(): void;
  /** "Começar vazio": a workspace with the team and templates only, no productions. */
  startEmpty(): void;
};

const NO_SCENARIOS: readonly SimulationScenario[] = Object.freeze([]);

export function useSimulation(): SimulationControls {
  const holder = useRuntimeHolder();
  const { runtime } = useRuntime();
  return useMemo(
    () => ({
      available: runtime?.mode === 'simulated',
      info: runtime?.simulation,
      scenarios: runtime ? runtime.generation.scenarios() : NO_SCENARIOS,
      reset: () => holder.reset(),
      startEmpty: () => holder.reset({ empty: true }),
    }),
    [holder, runtime],
  );
}

const IDLE_SAVE: SaveState = Object.freeze({ status: 'idle', scope: 'memory' });
const getIdleSave = (): SaveState => IDLE_SAVE;
const noopUnsubscribe = () => () => {};

/** Honest save status for the ActionBar ("Salvo neste navegador", or the error and retry). */
export function useSaveStatus(): SaveState {
  const { runtime } = useRuntime();
  const port = runtime?.saveStatus;
  const subscribe = useCallback((onChange: () => void) => (port ? port.subscribe(() => onChange()) : noopUnsubscribe()), [port]);
  const getSnapshot = useCallback(() => (port ? port.current() : IDLE_SAVE), [port]);
  return useSyncExternalStore(subscribe, getSnapshot, getIdleSave);
}
