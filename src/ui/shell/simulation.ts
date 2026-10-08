'use client';

import { useSyncExternalStore } from 'react';
import type { GenerationKind, SimulationScenario } from '@/ports';

/**
 * ⌘K › Simulação arms a failure/pause scenario for the NEXT generation of a matching kind
 * (StartOptions.simulation). Screens that start a run call `takeArmedSimulation(kind)` and pass
 * the result as `{ simulation }`; it disarms itself once used. Only offered in simulated mode.
 */

let armed: SimulationScenario | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function armSimulation(scenario: SimulationScenario | null): void {
  armed = scenario;
  emit();
}

/** The scenario id for a run of `kind` (and disarms it), or `undefined`. */
export function takeArmedSimulation(kind: GenerationKind): string | undefined {
  if (!armed || !armed.kinds.includes(kind)) return undefined;
  const id = armed.id;
  armSimulation(null);
  return id;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => armed;
const readNone = () => null;

export function useArmedSimulation(): SimulationScenario | null {
  return useSyncExternalStore(subscribe, read, readNone);
}
