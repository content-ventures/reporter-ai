import type { PersonId, WorkspaceId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';
import type { Role, Workspace } from '../domain/workspace.ts';
import type { ChangeListener, PersonSummary, Unsubscribe } from './common.ts';

/**
 * Who is using the product (REQ-T.1 plug point). R1 runs one workspace with fixture members;
 * the real adapter will come from the login session. `actAs` exists only in simulated mode, to
 * demo the two-person gate ("Agir como João / Pedro").
 */

export type SessionMode = 'simulated' | 'remote';

export type SessionMember = PersonSummary & {
  workspaceId: WorkspaceId;
  roles: Role[];
};

export type ActAsRefusal = 'unknown_member' | 'not_simulated';

export interface SessionPort {
  readonly mode: SessionMode;
  workspace(): Promise<Workspace>;
  /** The acting member; `undefined` means signed out (never in R1). */
  current(): Promise<SessionMember | undefined>;
  members(): Promise<SessionMember[]>;
  /** Simulated mode only: switch the acting member. Remote adapters omit it. */
  actAs?(personId: PersonId): Promise<Result<SessionMember, ActAsRefusal>>;
  subscribe(listener: ChangeListener): Unsubscribe;
}
