import type { PersonId, WorkspaceId } from '../domain/ids.ts';
import type { ProfilePatch, ProfileRefusal } from '../domain/profile.ts';
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
  /** The sign-in e-mail, on `current()` only (never on `members()`). */
  email?: string;
};

/** A photo picked on "Meu perfil": the adapter squares it before storing it. */
export type AvatarInput = { file: Blob; fileName: string };

export type ActAsRefusal = 'unknown_member' | 'not_simulated';

/** Test profiles of the one loopback operator. Not account switching or production login. */
export type LocalRoleProfileId = 'all' | 'editor' | 'approver' | 'creative_reviewer' | 'admin';
export type LocalRoleProfile = { id: LocalRoleProfileId; label: string; roles: Role[] };
export type LocalRoleRefusal = 'not_local_operator' | 'unknown_profile' | 'unavailable';

export interface SessionPort {
  readonly mode: SessionMode;
  workspace(): Promise<Workspace>;
  /** The acting member; `undefined` means signed out (never in R1). */
  current(): Promise<SessionMember | undefined>;
  members(): Promise<SessionMember[]>;
  /** Simulated mode only: switch the acting member. Remote adapters omit it. */
  actAs?(personId: PersonId): Promise<Result<SessionMember, ActAsRefusal>>;
  /** Only an explicitly local adapter exposes these capabilities. */
  localRoleProfiles?(): Promise<LocalRoleProfile[]>;
  selectLocalRole?(profile: LocalRoleProfileId): Promise<Result<SessionMember, LocalRoleRefusal>>;
  /** "Meu perfil": the acting member's own name and cargo. Nobody else's profile changes. */
  updateProfile(patch: ProfilePatch): Promise<Result<SessionMember, ProfileRefusal>>;
  /** The acting member's photo; `null` removes it. */
  setAvatar(input: AvatarInput | null): Promise<Result<SessionMember, ProfileRefusal>>;
  subscribe(listener: ChangeListener): Unsubscribe;
}
