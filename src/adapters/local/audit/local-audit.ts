import { auditTitle, auditTypeOf, AUDIT_RESTRICTED_MESSAGE, canReadAudit, compareAuditDesc } from '../../../domain/audit.ts';
import type { AuditEvent, AuditTarget } from '../../../domain/audit.ts';
import type { ActorId, PersonId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { foldForMatch } from '../../../domain/text/normalize.ts';
import { AUDIT_UNAVAILABLE_MESSAGE } from '../../../ports/audit.ts';
import type { AuditEntry, AuditFilter, AuditMetrics, AuditPage, AuditQueries } from '../../../ports/audit.ts';
import { DEFAULT_PAGE_SIZE } from '../../../ports/common.ts';
import type { ChangeListener, ChangeNotice, PageRequest, PersonSummary } from '../../../ports/common.ts';
import type { Clock } from '../../../ports/system.ts';
import type { LocalStore } from '../store/local-store.ts';
import { currentMember, personOf } from '../store/people.ts';
import { detach } from '../store/queries.ts';
import type { StoreState } from '../store/state.ts';
import type { KeyValueStorage } from '../store/storage.ts';
import { auditFromActivity } from './from-activity.ts';
import { updatesBetween } from './state-diff.ts';

/**
 * Local simulated AuditQueries: the activity feed seen as an audit trail, plus the seeded
 * history and what this browser recorded live (sign-ins when "Entrar como" switches the acting
 * member, access denials of this screen, field updates found by diffing the store). Read-only;
 * admins only. Live entries persist in this browser under their own key; the Conexão moves the
 * whole trail to the server.
 */

export const AUDIT_STORAGE_KEY = 'reporter:audit:v1';

/** Live entries kept in this browser (oldest dropped first). */
const MAX_LIVE = 400;

const LOGS_PAGE: AuditTarget = { kind: 'page', id: '/admin/audit', label: 'Logs' };

const THIS_BROWSER = { channel: 'web', device: 'Este navegador' } as const;

export type LocalAuditOptions = {
  store: Pick<LocalStore, 'state' | 'subscribe'>;
  clock: Clock;
  /** Seeded history the feed does not carry; evaluated on first read. */
  seed?: () => readonly AuditEvent[];
  /** Where live entries persist; omit to keep them in memory. */
  storage?: KeyValueStorage;
  /** Drop live entries an earlier session left in this browser (`?reset=1`, fresh fixtures). */
  reset?: boolean;
  /** Repeated denials of the same person and target inside this window count once (default 10 min). */
  denialWindowMs?: number;
};

export type LocalAudit = AuditQueries & {
  dispose(): void;
  /** A refusal the acting member saw (a production restricted to another team), once per window. */
  recordDenial(target: AuditTarget, reason: string): void;
};

type Stored = { version: 1; seq: number; events: AuditEvent[] };

function readStored(storage: KeyValueStorage | undefined): Stored {
  if (!storage) return { version: 1, seq: 0, events: [] };
  try {
    const raw = storage.getItem(AUDIT_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Stored>) : undefined;
    if (parsed?.version === 1 && Array.isArray(parsed.events) && typeof parsed.seq === 'number') return { version: 1, seq: parsed.seq, events: parsed.events };
  } catch {
    // A damaged entry starts the live trail again; the seeded history and the feed remain.
  }
  return { version: 1, seq: 0, events: [] };
}

/** Union by id, oldest first (another tab of this browser may have recorded meanwhile). */
function mergeEvents(base: readonly AuditEvent[], extra: readonly AuditEvent[]): AuditEvent[] {
  const ids = new Set(base.map((event) => event.id));
  const all = [...base, ...extra.filter((event) => !ids.has(event.id))];
  all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all.length > MAX_LIVE ? all.slice(all.length - MAX_LIVE) : all;
}

/** Lower case, accents and punctuation folded: "Aprovação" matches "aprovacao". */
function fold(text: string): string {
  return foldForMatch(text).normalize('NFD').replace(/\p{M}/gu, '');
}

function haystack(entry: AuditEntry): string {
  const parts = [
    entry.title,
    entry.actor?.name ?? 'Sistema',
    entry.target?.label,
    entry.productionTitle,
    entry.reason,
    entry.id,
    entry.requestId,
    entry.activityId,
    entry.target?.id,
    ...(entry.changes ?? []).flatMap((change) => [change.field, change.before, change.after]),
  ];
  return fold(parts.filter(Boolean).join(' '));
}

function inRange(entry: AuditEntry, filter: AuditFilter): boolean {
  const at = Date.parse(entry.at);
  if (filter.from && at < Date.parse(filter.from)) return false;
  if (filter.to && at > Date.parse(filter.to)) return false;
  return true;
}

function metricsOf(entries: readonly AuditEntry[]): AuditMetrics {
  const metrics: AuditMetrics = { events: entries.length, people: new Set(entries.map((entry) => entry.actorId)).size, signIns: 0, denied: 0, failures: 0 };
  for (const entry of entries) {
    if (entry.action === 'auth.signed_in' && entry.result === 'success') {
      metrics.signIns += 1;
      if (!metrics.lastSignInAt || entry.at > metrics.lastSignInAt) metrics.lastSignInAt = entry.at;
    }
    if (entry.result === 'denied') {
      metrics.denied += 1;
      if (!metrics.lastDeniedAt || entry.at > metrics.lastDeniedAt) metrics.lastDeniedAt = entry.at;
    } else if (entry.result === 'failure') {
      metrics.failures += 1;
      if (!metrics.lastFailureAt || entry.at > metrics.lastFailureAt) metrics.lastFailureAt = entry.at;
    }
  }
  return metrics;
}

export function createLocalAudit(options: LocalAuditOptions): LocalAudit {
  const { store, clock, storage } = options;
  const denialWindowMs = options.denialWindowMs ?? 10 * 60 * 1000;
  const listeners = new Set<ChangeListener>();
  let outage = false;
  let seeded: readonly AuditEvent[] | undefined;

  if (options.reset && storage) {
    try {
      storage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      // Memory state starts empty regardless.
    }
  }
  let live: Stored = options.reset ? { version: 1, seq: 0, events: [] } : readStored(storage);
  let previous: StoreState = store.state;

  function persist(): void {
    if (!storage) return;
    try {
      storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(live));
    } catch {
      // Out of space: the live entries stay in this tab; the workspace save reports the quota.
    }
  }

  function record(drafts: readonly Omit<AuditEvent, 'id' | 'workspaceId' | 'at' | 'requestId'>[], actorId: ActorId): void {
    if (drafts.length === 0) return;
    const at = clock.now();
    // Another tab may have recorded since this one last read: merge before writing.
    const stored = readStored(storage);
    let seq = Math.max(live.seq, stored.seq);
    // The instant keeps ids unique across tabs that share this browser's trail.
    const stamp = Date.parse(at).toString(36);
    const events = drafts.map((draft): AuditEvent => {
      seq += 1;
      const id = `aud-l-${stamp}-${String(seq).padStart(4, '0')}`;
      return { ...draft, actorId: draft.actorId ?? actorId, id, workspaceId: store.state.workspace.id, at, requestId: `req-${stamp}${seq}` };
    });
    live = { version: 1, seq, events: mergeEvents(mergeEvents(stored.events, live.events), events) };
    persist();
  }

  function notify(): void {
    const notice: ChangeNotice = { scope: 'audit', productionIds: [], activity: [] };
    for (const listener of [...listeners]) listener(notice);
  }

  // Sign-ins on "Entrar como" and field updates, recorded as the store changes.
  const unsubscribe = store.subscribe((notice) => {
    const next = store.state;
    if (notice.scope === 'reset') {
      live = { version: 1, seq: live.seq, events: [] };
      persist();
      previous = next;
      return;
    }
    // Another tab saved the workspace and this one reloaded it: its changes are that tab's to
    // record (already in the shared trail), not this tab's.
    if (notice.scope === 'external') {
      const stored = readStored(storage);
      live = { version: 1, seq: Math.max(live.seq, stored.seq), events: mergeEvents(stored.events, live.events) };
      previous = next;
      return;
    }
    const before = previous;
    previous = next;
    if (before.sessionPersonId !== next.sessionPersonId) {
      record(
        [
          { actorId: before.sessionPersonId, action: 'auth.signed_out', result: 'success', origin: THIS_BROWSER },
          { actorId: next.sessionPersonId, action: 'auth.signed_in', result: 'success', origin: THIS_BROWSER },
        ],
        next.sessionPersonId,
      );
    }
    const updates = updatesBetween(before, next);
    if (updates.length > 0) {
      record(
        updates.map((update) => ({ ...update, actorId: next.sessionPersonId, result: 'success' as const, origin: THIS_BROWSER })),
        next.sessionPersonId,
      );
    }
  });

  // ── Read model ─────────────────────────────────────────────────────────────────────────

  let cache: { activity: unknown; productions: unknown; people: unknown; sources: unknown; liveSeq: number; liveCount: number; entries: AuditEntry[] } | undefined;

  function productionIds(state: StoreState): Set<string> {
    return new Set(state.productions.map((entry) => entry.production.id));
  }

  function enrich(event: AuditEvent, state: StoreState, known: Set<string>): AuditEntry {
    const entry: AuditEntry = { ...event, actor: personOf(state, event.actorId), title: auditTitle(event.action, event.result), type: auditTypeOf(event.action) };
    const productionId = event.target?.productionId;
    if (productionId) {
      const production = state.productions.find((candidate) => candidate.production.id === productionId);
      entry.productionAvailable = known.has(productionId);
      if (production) entry.productionTitle = production.production.title;
    }
    return entry;
  }

  function entries(): AuditEntry[] {
    const state = store.state;
    if (
      cache &&
      cache.activity === state.activity &&
      cache.productions === state.productions &&
      cache.people === state.people &&
      cache.sources === state.sources &&
      cache.liveSeq === live.seq &&
      cache.liveCount === live.events.length
    ) {
      return cache.entries;
    }
    seeded ??= options.seed?.() ?? [];
    const known = productionIds(state);
    const pieceKinds = new Map(state.productions.flatMap((entry) => entry.pieces.map((piece) => [piece.id, piece.kind] as const)));
    const fromFeed = state.activity.map((event) => auditFromActivity(event, { pieceKind: (pieceId) => pieceKinds.get(pieceId) })).filter((event): event is AuditEvent => event !== undefined);
    // Seeded entries about a production this workspace does not have (a reopened empty workspace) are dropped.
    const fromSeed = seeded.filter((event) => !event.target?.productionId || known.has(event.target.productionId));
    const all = [...fromFeed, ...fromSeed, ...live.events].map((event) => enrich(event, state, known)).sort(compareAuditDesc);
    cache = { activity: state.activity, productions: state.productions, people: state.people, sources: state.sources, liveSeq: live.seq, liveCount: live.events.length, entries: all };
    return all;
  }

  function people(all: readonly AuditEntry[]): PersonSummary[] {
    const byId = new Map<string, PersonSummary>();
    for (const entry of all) if (entry.actor && !byId.has(entry.actor.id)) byId.set(entry.actor.id, entry.actor);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  /** The viewer's refusal, recorded as an access denial (repeats inside the window count once). */
  function deny(target: AuditTarget = LOGS_PAGE, reason: string = AUDIT_RESTRICTED_MESSAGE): boolean {
    const state = store.state;
    const actorId: PersonId = currentMember(state)?.personId ?? state.sessionPersonId;
    const now = Date.parse(clock.now());
    const recent = live.events.some(
      (event) => event.action === 'access.denied' && event.actorId === actorId && event.target?.id === target.id && now - Date.parse(event.at) < denialWindowMs,
    );
    if (recent) return false;
    record([{ actorId, action: 'access.denied', result: 'denied', target, reason, origin: THIS_BROWSER }], actorId);
    return true;
  }

  function readable(): boolean {
    return canReadAudit(currentMember(store.state)?.roles);
  }

  return {
    async list(filter: AuditFilter = {}, request: Partial<PageRequest> = {}) {
      if (outage) {
        outage = false;
        return refuse('unavailable', AUDIT_UNAVAILABLE_MESSAGE);
      }
      if (!readable()) {
        deny();
        return refuse('restricted', AUDIT_RESTRICTED_MESSAGE);
      }
      const all = entries();
      const terms = filter.search?.trim() ? fold(filter.search).split(' ').filter(Boolean) : [];
      const scoped = all.filter(
        (entry) =>
          inRange(entry, filter) &&
          (!filter.actorIds?.length || filter.actorIds.includes(entry.actorId)) &&
          (!filter.types?.length || filter.types.includes(entry.type)) &&
          (terms.length === 0 || terms.every((term) => haystack(entry).includes(term))),
      );
      const matching = filter.results?.length ? scoped.filter((entry) => filter.results?.includes(entry.result)) : scoped;
      const ordered = filter.sort === 'oldest' ? [...matching].reverse() : matching;
      const size = Math.max(1, Math.min(100, request.size ?? DEFAULT_PAGE_SIZE));
      const pageCount = Math.max(1, Math.ceil(ordered.length / size));
      const page = Math.min(Math.max(1, request.page ?? 1), pageCount);
      const answer: AuditPage = {
        items: ordered.slice((page - 1) * size, page * size),
        total: ordered.length,
        page,
        size,
        pageCount,
        metrics: metricsOf(scoped),
        people: people(all),
      };
      const oldest = all[all.length - 1];
      if (oldest) answer.since = oldest.at;
      return ok(detach(answer));
    },
    async get(eventId) {
      if (outage) return refuse('unavailable', AUDIT_UNAVAILABLE_MESSAGE);
      if (!readable()) return refuse('restricted', AUDIT_RESTRICTED_MESSAGE);
      const entry = entries().find((candidate) => candidate.id === eventId);
      return entry ? ok(detach(entry)) : refuse('not_found', 'Este evento não está no registro.');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    simulateOutage() {
      outage = true;
      notify();
    },
    recordDenial(target, reason) {
      // An admin with the Logs open sees the new entry.
      if (deny(target, reason)) notify();
    },
    dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
}
