import type { IsoDateTime, PieceId } from '../../../domain/ids.ts';
import type { WorkingDraft } from '../../../domain/piece.ts';
import { isRunActive } from '../../../domain/run.ts';
import { migrateV1 } from './migrate.ts';
import { isStoreState } from './state.ts';
import type { StoreState } from './state.ts';
import type { KeyValueStorage } from './storage.ts';

/**
 * Persistence format. One versioned snapshot key holds the whole simulated workspace; a second
 * key is the OVERWRITTEN draft slot: autosave writes only the drafts changed since the last
 * full snapshot (never an ever-growing log), and a full snapshot clears it.
 */

export const SNAPSHOT_KEY = 'reporter:sim:v1';
export const DRAFT_SLOT_KEY = 'reporter:sim:v1:drafts';
/**
 * Who wrote the workspace last (`{tab}:{seq}`), rewritten with every snapshot or draft-slot
 * write. A tab compares it with the last writer it saw: different means another tab of this
 * browser wrote meanwhile (reload, or stop writing instead of overwriting its work).
 */
export const WRITER_KEY = 'reporter:sim:v1:writer';
/** Every key of the saved workspace (a `storage` event on one of them is another tab writing). */
export const WORKSPACE_KEYS: readonly string[] = [SNAPSHOT_KEY, DRAFT_SLOT_KEY, WRITER_KEY];
/** 2: article size by lauda (`brief.size`); schema 1 snapshots are migrated on read (`migrateV1`). */
export const SNAPSHOT_SCHEMA = 2;
/** Schemas `readSnapshot` still reads, oldest first. */
const READABLE_SCHEMAS: readonly number[] = [1, SNAPSHOT_SCHEMA];

type SnapshotEnvelope = { schema: number; savedAt: IsoDateTime; state: StoreState };
type DraftSlotEnvelope = { schema: number; savedAt: IsoDateTime; drafts: Record<PieceId, WorkingDraft> };

export type LoadIssue = 'corrupt' | 'schema' | 'unreadable';

export type LoadedSnapshot =
  | { kind: 'empty' }
  | { kind: 'loaded'; state: StoreState; savedAt: IsoDateTime; draftsApplied: number }
  | { kind: 'invalid'; issue: LoadIssue };

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  return JSON.parse(raw) as unknown;
}

/** Applies newer slot drafts (higher revision) over the snapshot's pieces. */
function applyDraftSlot(state: StoreState, slot: DraftSlotEnvelope | undefined): { state: StoreState; applied: number } {
  // Drafts did not change between schemas: a schema 1 slot still applies.
  if (!slot || !READABLE_SCHEMAS.includes(slot.schema) || typeof slot.drafts !== 'object' || slot.drafts === null) return { state, applied: 0 };
  let applied = 0;
  const productions = state.productions.map((production) => {
    let touched = false;
    const pieces = production.pieces.map((piece) => {
      const draft = slot.drafts[piece.id];
      if (!draft || typeof draft.revision !== 'number' || draft.revision <= piece.draft.revision) return piece;
      if (draft.body?.type !== piece.draft.body.type) return piece;
      touched = true;
      applied += 1;
      return { ...piece, draft };
    });
    return touched ? { ...production, pieces } : production;
  });
  return { state: applied > 0 ? { ...state, productions } : state, applied };
}

export function readSnapshot(storage: KeyValueStorage): LoadedSnapshot {
  let envelope: unknown;
  let slot: unknown;
  try {
    envelope = parse(storage.getItem(SNAPSHOT_KEY));
    slot = parse(storage.getItem(DRAFT_SLOT_KEY));
  } catch (error) {
    return { kind: 'invalid', issue: error instanceof SyntaxError ? 'corrupt' : 'unreadable' };
  }
  if (envelope === undefined) return { kind: 'empty' };
  const candidate = envelope as Partial<SnapshotEnvelope>;
  if (candidate.schema === undefined || !READABLE_SCHEMAS.includes(candidate.schema)) return { kind: 'invalid', issue: 'schema' };
  if (!isStoreState(candidate.state)) return { kind: 'invalid', issue: 'corrupt' };
  const current = candidate.schema === 1 ? migrateV1(candidate.state) : candidate.state;
  const { state, applied } = applyDraftSlot(current, slot as DraftSlotEnvelope | undefined);
  return { kind: 'loaded', state, savedAt: candidate.savedAt ?? '', draftsApplied: applied };
}

export function writeSnapshot(storage: KeyValueStorage, state: StoreState, savedAt: IsoDateTime, writer?: string): void {
  const envelope: SnapshotEnvelope = { schema: SNAPSHOT_SCHEMA, savedAt, state };
  storage.setItem(SNAPSHOT_KEY, JSON.stringify(envelope));
  storage.removeItem(DRAFT_SLOT_KEY);
  if (writer) storage.setItem(WRITER_KEY, writer);
}

export function writeDraftSlot(storage: KeyValueStorage, drafts: Record<PieceId, WorkingDraft>, savedAt: IsoDateTime, writer?: string): void {
  const envelope: DraftSlotEnvelope = { schema: SNAPSHOT_SCHEMA, savedAt, drafts };
  storage.setItem(DRAFT_SLOT_KEY, JSON.stringify(envelope));
  if (writer) storage.setItem(WRITER_KEY, writer);
}

/** Last writer of the saved workspace; `null` when nobody wrote one (or storage is unreadable). */
export function readWriter(storage: KeyValueStorage): string | null {
  try {
    return storage.getItem(WRITER_KEY);
  } catch {
    return null;
  }
}

export function clearSnapshot(storage: KeyValueStorage): void {
  storage.removeItem(SNAPSHOT_KEY);
  storage.removeItem(DRAFT_SLOT_KEY);
  storage.removeItem(WRITER_KEY);
}

/**
 * Space saver used once when a write hits the quota: the stream snapshots of finished runs are
 * dropped (their outputs already live in versions; RunView keeps steps and provenance).
 */
export function compactState(state: StoreState): StoreState {
  const active = new Set(state.productions.flatMap((production) => production.runs.filter(isRunActive).map((run) => run.id)));
  const runFolds = Object.fromEntries(Object.entries(state.runFolds).filter(([runId]) => active.has(runId)));
  return { ...state, runFolds };
}
