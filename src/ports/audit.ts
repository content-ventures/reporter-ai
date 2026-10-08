import type { AuditEvent, AuditEventId, AuditResult, AuditType } from '../domain/audit.ts';
import type { ActorId, IsoDateTime } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';
import type { ChangeListener, Page, PageRequest, PersonSummary, Unsubscribe } from './common.ts';

/**
 * Read side of the audit trail (F1.7, Logs). Admins only: anyone else gets `restricted`, and the
 * refusal itself is audited (`access.denied`). R1 serves it from the local simulation; the
 * Conexão adapter reads the persisted table and must keep the same shapes and refusals.
 */

export type AuditSort = 'newest' | 'oldest';

export type AuditFilter = {
  /** Events inside [from, to] (inclusive). */
  from?: IsoDateTime;
  to?: IsoDateTime;
  actorIds?: ActorId[];
  types?: AuditType[];
  results?: AuditResult[];
  /** Matches the action line, the record, the reason and every id (case- and accent-insensitive). */
  search?: string;
  /** Default `newest`. */
  sort?: AuditSort;
};

export type AuditEntry = AuditEvent & {
  /** `null`: the system acted (a run settling, a scheduled job). */
  actor: PersonSummary | null;
  /** "Artigo atualizado", "Acesso negado". */
  title: string;
  type: AuditType;
  /** Current title of the production the record belongs to (it may have been renamed since). */
  productionTitle?: string;
  /** False when the production no longer exists here (the entry keeps the name it had). */
  productionAvailable?: boolean;
};

export type AuditMetrics = {
  events: number;
  /** Distinct people (and the system) in the events. */
  people: number;
  /** Successful sign-ins. */
  signIns: number;
  denied: number;
  failures: number;
  lastSignInAt?: IsoDateTime;
  lastDeniedAt?: IsoDateTime;
  lastFailureAt?: IsoDateTime;
};

export type AuditPage = Page<AuditEntry> & {
  /** Computed without the `results` filter, so the strip stays a breakdown while one result is picked. */
  metrics: AuditMetrics;
  /** Everyone who appears anywhere in the trail ("Pessoa" filter), by name. */
  people: PersonSummary[];
  /** Oldest event kept. */
  since?: IsoDateTime;
};

/** `restricted`: the viewer may not read the trail. `unavailable`: the log could not be read now. */
export type AuditRefusal = 'restricted' | 'unavailable';
export type AuditLookupRefusal = AuditRefusal | 'not_found';

export const AUDIT_UNAVAILABLE_MESSAGE = 'O registro de eventos não respondeu. Nenhum evento foi perdido.';

export interface AuditQueries {
  list(filter?: AuditFilter, page?: Partial<PageRequest>): Promise<Result<AuditPage, AuditRefusal>>;
  /** One entry (the event drawer, a shared `?event=` link). */
  get(eventId: AuditEventId): Promise<Result<AuditEntry, AuditLookupRefusal>>;
  /** Notices with scope `audit` (new entries no other notice announces, simulated outages). */
  subscribe(listener: ChangeListener): Unsubscribe;
  /** Simulated mode only (⌘K › Simulação): the next read of the trail fails as "Log indisponível". */
  simulateOutage?(): void;
}
