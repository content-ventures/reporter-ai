import type { ActivityType } from '../domain/activity.ts';
import type { PersonId, ProductionId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';

/**
 * Shapes shared by every port. Everything that crosses a port is serialisable data (no class
 * instances, no functions), so a remote adapter can return the same JSON the local one does.
 */

export type Unsubscribe = () => void;

/** What changed, so subscribers refetch only what they show (`assets`: article images, credit, rights). */
/** `external`: another tab of this browser saved the workspace and this tab reloaded it. */
export type ChangeScope = 'productions' | 'runs' | 'session' | 'feedback' | 'assets' | 'audit' | 'reset' | 'external';

export type ChangeNotice = {
  scope: ChangeScope;
  /** Productions touched by the change; empty when the change is workspace-wide. */
  productionIds: ProductionId[];
  /** Semantic activity logged by the change, if any. */
  activity: ActivityType[];
};

export type ChangeListener = (notice: ChangeNotice) => void;

/** 1-based page request. */
export type PageRequest = { page: number; size: number };

export type Page<T> = {
  items: T[];
  /** Items matching the filter across all pages. */
  total: number;
  /** Page actually served (clamped to `1..pageCount`). */
  page: number;
  size: number;
  pageCount: number;
};

export const DEFAULT_PAGE_SIZE = 20;

/** Lookups fail as "not found" now; "restricted" is the REQ-T.1 plug (AccessState restricted). */
export type LookupRefusal = 'not_found' | 'restricted';
export type Lookup<T> = Result<T, LookupRefusal>;

/** Everything the UI needs to draw a person (Avatar, owner column, timeline actor). */
export type PersonSummary = {
  id: PersonId;
  name: string;
  /** Two-letter initials for the Avatar fallback. */
  initials: string;
  /** "Cargo ou função". */
  title?: string;
  /** "Organização". */
  organization?: string;
  /** The line after the name in the text and in lists: "diretora de marketing da Casa Forma". */
  line?: string;
  avatarUrl?: string;
};

/**
 * UI hint for a button: enabled, or disabled with the pt-BR reason for its Tooltip. The adapter
 * enforces the same rule when the command runs, so a hint can never be bypassed.
 */
export type Guard = { allowed: true } | { allowed: false; code: string; reason: string };

export const ALLOWED: Guard = { allowed: true };

export function guardFrom(result: Result<unknown, string>): Guard {
  return result.ok ? ALLOWED : { allowed: false, code: result.refusal.code, reason: result.refusal.message };
}

export function blocked(code: string, reason: string): Guard {
  return { allowed: false, code, reason };
}

/** Refusal shared by every command when an id does not resolve. */
export type NotFoundRefusal = 'not_found';
