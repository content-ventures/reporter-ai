import type { IsoDateTime, PersonId } from '../domain/ids.ts';
import type { CommandContext } from '../domain/result.ts';

/**
 * Time and identity sources. Product code never calls `new Date()`, `Date.now()` or
 * `crypto.randomUUID()` (the last one throws in insecure contexts, e.g. a LAN preview over
 * http); it asks these ports, which tests replace with deterministic versions.
 */

export interface Clock {
  /** Current instant as an ISO-8601 string. */
  now(): IsoDateTime;
}

export interface IdGenerator {
  /** A new id, unique within the workspace, starting with `prefix` (e.g. `ver`, `dec`). */
  next(prefix: string): string;
}

/** Builds the context every domain command receives. */
export function commandContext(clock: Clock, ids: IdGenerator, actorId: PersonId): CommandContext {
  return { now: clock.now(), newId: (prefix) => ids.next(prefix), actorId };
}
