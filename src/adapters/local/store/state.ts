import type { ActivityEvent } from '../../../domain/activity.ts';
import type { FeedbackEntry } from '../../../domain/feedback.ts';
import type { PersonId, PieceId, ProductionId, RunId, SourceId, VersionId } from '../../../domain/ids.ts';
import type { ApprovalPoint } from '../../../domain/overview.ts';
import type { Piece, Version } from '../../../domain/piece.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import type { RunFold } from '../../../domain/run-events.ts';
import type { Source } from '../../../domain/source.ts';
import type { Member, Person, Workspace } from '../../../domain/workspace.ts';

/**
 * In-memory state of the simulated workspace. Sources live at workspace level (a source can
 * later feed several productions); a production keeps everything else of its record.
 * State is treated as immutable: every change produces new objects, so identity = freshness.
 */

export type ProductionState = Omit<ProductionRecord, 'sources'>;

export type StoreState = {
  workspace: Workspace;
  people: Person[];
  members: Member[];
  /** Acting member in simulated mode ("Agir como"). */
  sessionPersonId: PersonId;
  sources: Source[];
  productions: ProductionState[];
  activity: ActivityEvent[];
  feedback: FeedbackEntry[];
  /** Seeded summary of past approvals (60-day history) for believable 7/30-day deltas. */
  history: ApprovalPoint[];
  /** Latest snapshot of each run's stream (the `attach` snapshot). */
  runFolds: Record<RunId, RunFold>;
};

/** What fixtures hand to the store. Records may embed their sources; they are normalised. */
export type StoreSeed = {
  workspace: Workspace;
  people: Person[];
  members: Member[];
  sessionPersonId?: PersonId;
  records?: ProductionRecord[];
  sources?: Source[];
  activity?: ActivityEvent[];
  feedback?: FeedbackEntry[];
  history?: ApprovalPoint[];
  runFolds?: Record<RunId, RunFold>;
};

export function normalizeSeed(seed: StoreSeed): StoreState {
  const sources = new Map<SourceId, Source>();
  for (const source of seed.sources ?? []) sources.set(source.id, source);
  for (const record of seed.records ?? []) {
    for (const source of record.sources) if (!sources.has(source.id)) sources.set(source.id, source);
  }
  const productions: ProductionState[] = (seed.records ?? []).map((record) => ({
    production: record.production,
    pieces: record.pieces,
    versions: record.versions,
    decisions: record.decisions,
    reviewRequests: record.reviewRequests,
    runs: record.runs,
    suggestions: record.suggestions,
    deliveries: record.deliveries,
  }));
  const sessionPersonId = seed.sessionPersonId ?? seed.members[0]?.personId;
  if (!sessionPersonId) throw new Error('Store seed needs at least one member.');
  return {
    workspace: seed.workspace,
    people: seed.people,
    members: seed.members,
    sessionPersonId,
    sources: [...sources.values()],
    productions,
    activity: seed.activity ?? [],
    feedback: seed.feedback ?? [],
    history: seed.history ?? [],
    runFolds: seed.runFolds ?? {},
  };
}

/** The domain record of one production (sources resolved from the workspace). */
export function assembleRecord(state: Pick<StoreState, 'sources'>, production: ProductionState): ProductionRecord {
  const sources = production.production.sourceIds
    .map((id) => state.sources.find((source) => source.id === id))
    .filter((source): source is Source => source !== undefined);
  return { ...production, sources };
}

export function findProduction(state: StoreState, productionId: ProductionId): ProductionState | undefined {
  return state.productions.find((entry) => entry.production.id === productionId);
}

export type PieceLocation = { production: ProductionState; piece: Piece };

export function locatePiece(state: StoreState, pieceId: PieceId): PieceLocation | undefined {
  for (const production of state.productions) {
    const piece = production.pieces.find((candidate) => candidate.id === pieceId);
    if (piece) return { production, piece };
  }
  return undefined;
}

export function locateVersion(state: StoreState, versionId: VersionId): { production: ProductionState; version: Version } | undefined {
  for (const production of state.productions) {
    const version = production.versions.find((candidate) => candidate.id === versionId);
    if (version) return { production, version };
  }
  return undefined;
}

export function locateRun(state: StoreState, runId: RunId): ProductionState | undefined {
  return state.productions.find((production) => production.runs.some((run) => run.id === runId));
}

/** Replaces one production (matched by id) with an updated copy. */
export function withProduction(state: StoreState, next: ProductionState): StoreState {
  return {
    ...state,
    productions: state.productions.map((entry) => (entry.production.id === next.production.id ? next : entry)),
  };
}

export function withPiece(production: ProductionState, piece: Piece): ProductionState {
  return { ...production, pieces: production.pieces.map((entry) => (entry.id === piece.id ? piece : entry)) };
}

export function withSource(state: StoreState, source: Source): StoreState {
  return { ...state, sources: state.sources.map((entry) => (entry.id === source.id ? source : entry)) };
}

/** Productions that use a source (for duplicate detection and "Material" links). */
export function productionsUsingSource(state: StoreState, sourceId: SourceId): ProductionState[] {
  return state.productions.filter((entry) => entry.production.sourceIds.includes(sourceId));
}

/** Minimal structural validation of a persisted state (guards against corrupted snapshots). */
export function isStoreState(value: unknown): value is StoreState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.workspace === 'object' &&
    state.workspace !== null &&
    typeof state.sessionPersonId === 'string' &&
    ['people', 'members', 'sources', 'productions', 'activity', 'feedback', 'history'].every((key) => Array.isArray(state[key])) &&
    typeof state.runFolds === 'object' &&
    state.runFolds !== null
  );
}
