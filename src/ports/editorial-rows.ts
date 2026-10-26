import type { PipelineRevision } from '../domain/pipeline.ts';
import type { RunEvent, RunFold } from '../domain/run-events.ts';
import type { Source } from '../domain/source.ts';
import type { Workspace } from '../domain/workspace.ts';
import type { EditorialJob, EditorialState } from './connected-workspace.ts';

/** The editorial checkpoint as database rows, and the deltas browsers receive. */
export type ProductionState = EditorialState['productions'][number];

export const PART_FIELDS = { piece: 'pieces', version: 'versions', decision: 'decisions', review: 'reviewRequests',
  run: 'runs', suggestion: 'suggestions', delivery: 'deliveries' } as const;
export type PartKind = keyof typeof PART_FIELDS;
export const PART_KINDS = Object.keys(PART_FIELDS) as PartKind[];
export type ItemKind = 'person' | 'member' | 'activity' | 'feedback' | 'image_asset' | 'citation' | 'library_image' | 'banner' | 'fact_check';

export type PipelineReference=Pick<PipelineRevision,'hash'|'revision'|'savedAt'>;
export type WorkspaceDoc = { workspace: Workspace; pipelineHash?: string; historyHashes?: string[];pipelineRef?:PipelineReference;historyRefs?:PipelineReference[] };
export type ProductionRow = { id: string; ordinal?: number; doc: ProductionState['production']; sourceIds: string[]; archived: boolean };
export type PartRow = { kind: PartKind; id: string; productionId: string; ordinal?: number; doc: unknown; deleted?: boolean };
export type SourceRow = { id: string; ordinal?: number; doc: Source };
export type JobDoc = Omit<EditorialJob, 'events' | 'attempts' | 'availableAt' | 'lease' | 'pipeline'> & { pipelineHash?: string;pipelineRef?:PipelineReference };
export type RunRow = { id: string; productionId: string; status: string; availableAt?: number; lease?: EditorialJob['lease'] | null;
  attempts?: number; job: JobDoc | null; fold: RunFold };
export type EventRow = { runId: string; event: RunEvent };
export type ItemRow = { kind: ItemKind; id: string; productionId: string | null; ordinal?: number; doc: unknown; deleted?: boolean };
export type PipelineRow = { hash: string; doc: PipelineRevision };

export type EditorialRows = {
  seq: number; workspace: WorkspaceDoc | null; productions: ProductionRow[]; parts: PartRow[]; sources: SourceRow[];
  runs: RunRow[]; events: EventRow[]; items: ItemRow[]; pipelines: PipelineRow[];
};
/** What a scope loaded, so absent rows are read as "not loaded" rather than "deleted". */
export type LoadedScope = { parts: readonly PartKind[]; partIds?: readonly string[]; items: readonly ItemKind[]; history: boolean };
export type EditorialChanges = {
  workspace?: WorkspaceDoc; productions: ProductionRow[]; parts: PartRow[]; sources: SourceRow[];
  runs: RunRow[]; events: EventRow[]; items: ItemRow[]; pipelines: PipelineRow[];
};

/** Rows changed since the browser's number, as `reporter_ed_changes` returns them. */
export type WorkspaceDelta = {
  seq: number; productions: ProductionRow[]; parts: PartRow[]; sources: SourceRow[];
  runs: { id: string; productionId: string; status: string; job: Pick<EditorialJob, 'meta' | 'kind'>; fold: RunFold }[];
  events: EventRow[]; items: ItemRow[];
};
