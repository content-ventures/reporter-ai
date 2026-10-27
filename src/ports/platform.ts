import type { PersonId } from '../domain/ids.ts';
import type { AccessStatus,InviteInput, InviteLinkRefusal, InvitePreview, IssuedInvite, PasswordRefusal, PlatformLogEntry, PlatformPerson, PlatformRefusal, PlatformWorkspace } from '../domain/platform.ts';
import type { UsagePeriod, UsageReport } from '../domain/platform-usage.ts';
import type { Result } from '../domain/result.ts';
import type { Role } from '../domain/workspace.ts';
import type { Unsubscribe } from './common.ts';

/**
 * Console da plataforma. The demo adapter keeps everything in this browser; the connected one
 * calls `/api/reporter/platform`, where every read and write checks the platform role in the
 * database and every write is logged. Anyone without the role gets `restricted`.
 */

export type PlatformOperator = { id: PersonId; name: string; email: string; avatarUrl?: string };

export type PlatformDirectory = {
  people: PlatformPerson[];
  workspaces: PlatformWorkspace[];
  total?:number;offset?:number;workspaceTotal?:number;counts?:Record<AccessStatus|'all',number>;
};
export type PlatformPersonLabel=Pick<PlatformOperator,'id'|'name'|'avatarUrl'>;
export type PlatformFilter={workspaceId?:string;personId?:string};
export type DirectorySearch=PlatformFilter&{search?:string;status?:AccessStatus;limit?:number;offset?:number};

export type PlatformLogPage = { items: PlatformLogEntry[]; total: number };

export type PlatformResult<T> = Result<T, PlatformRefusal>;

/** `restore` of someone who never defined a password issues a new link. */
export type Restored = { person: PlatformPerson; invite?: IssuedInvite };

export interface PlatformConsole {
  readonly mode: 'demo' | 'connected';
  /** The signed-in operator, or `restricted`. */
  operator(): Promise<PlatformResult<PlatformOperator>>;
  /** Bounded global directory, with independent memberships in every returned person. */
  directory(options?:DirectorySearch): Promise<PlatformResult<PlatformDirectory>>;
  peopleLabels?(ids:readonly PersonId[]):Promise<PlatformResult<PlatformPersonLabel[]>>;
  usage(period: UsagePeriod,filter?:PlatformFilter): Promise<PlatformResult<UsageReport>>;
  log(limit: number,options?:PlatformFilter&{offset?:number}): Promise<PlatformResult<PlatformLogPage>>;
  accountStatus?(personId:PersonId,suspended:boolean):Promise<PlatformResult<PlatformPerson>>;
  invite(input: InviteInput): Promise<PlatformResult<IssuedInvite>>;
  /** A fresh link for someone still `invited`; the previous one stops working. */
  renewInvite(personId: PersonId): Promise<PlatformResult<IssuedInvite>>;
  /** Releases a `pending` self sign-up with the roles given. */
  approve(personId: PersonId, roles: Role[]): Promise<PlatformResult<PlatformPerson>>;
  setRoles(personId: PersonId, roles: Role[]): Promise<PlatformResult<PlatformPerson>>;
  /** Blocks access at once; an open link stops working too. */
  suspend(personId: PersonId): Promise<PlatformResult<PlatformPerson>>;
  restore(personId: PersonId): Promise<PlatformResult<Restored>>;
  /** Fires after every write of this console. */
  subscribe(listener: () => void): Unsubscribe;
}

export type InviteLookupRefusal = 'invalid_link' | 'unavailable';

/** `signIn`: the browser opens the Neon Auth session with the same e-mail and password next. */
export type InviteAccepted = { email: string; signIn: boolean };
export type InviteAcceptRefusal = PasswordRefusal | InviteLinkRefusal;

/** The page the link opens (`/auth/invite/<token>`), before anyone is signed in. */
export interface InviteDesk {
  preview(token: string): Promise<Result<InvitePreview, InviteLookupRefusal>>;
  /**
   * Defines the password, or checks the one an existing account already has, and releases the
   * access. The caller signs in right after with the same e-mail and password.
   */
  accept(token: string, password: string, confirmation: string): Promise<Result<InviteAccepted, InviteAcceptRefusal>>;
}
