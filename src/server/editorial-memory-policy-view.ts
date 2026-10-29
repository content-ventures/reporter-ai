import type { MemoryPolicy } from '../domain/editorial-memory.ts';
/** Scoring data stays inside the worker/admin boundary; public readers need only active settings. */
export function memoryPolicyView(policy: MemoryPolicy): MemoryPolicy {
  const result = { ...policy }; delete result.calibration; return result;
}
