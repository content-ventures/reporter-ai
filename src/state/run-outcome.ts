import type { RunUpdate } from '../ports/generation.ts';

/** A top-level run (not a per-section child run) reached its end: completed, failed or cancelled. */
export function isTerminalUpdate(update: RunUpdate): boolean {
  if (update.meta.child) return false;
  const type = update.event.type;
  return type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled';
}
