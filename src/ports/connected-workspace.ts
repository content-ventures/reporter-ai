import type { ActivityEvent } from '../domain/activity.ts';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { ApprovalPoint } from '../domain/overview.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { Source } from '../domain/source.ts';
import type { RunEvent, RunFold } from '../domain/run-events.ts';
import type { Person, Member, Workspace } from '../domain/workspace.ts';
import type { GenerationKind, GenerationInputs, RunMeta } from './generation.ts';
import type { PipelineRevision, PipelineCall } from '../domain/pipeline.ts';
import type { BannerDraft, LibraryImage } from '../domain/visual-library.ts';
import type { Citation } from '../domain/citation-library.ts';
import type { ImageAsset } from '../domain/asset.ts';

export type ServerImageAsset = { productionId: string; asset: ImageAsset; fileKey?: string };

/** Server-owned aggregate. Browser copies are read projections, never write payloads. */
export type EditorialState = {
  workspace: Workspace; people: Person[]; members: Member[]; sessionPersonId: string;
  sources: Source[]; productions: Omit<ProductionRecord, 'sources'>[];
  activity: ActivityEvent[]; feedback: FeedbackEntry[]; history: ApprovalPoint[];
  runFolds: Record<string, RunFold>;
};
export type EditorialJob = {
  meta: RunMeta; kind: GenerationKind; input: GenerationInputs[GenerationKind];
  events: RunEvent[]; attempts: number; availableAt: number;
  contextHash?: string;
  /** Server-selected retry parent with identical context and immutable prompt snapshot. */
  cacheSourceRunId?: string;
  pipeline?: PipelineRevision;
  calls?: PipelineCall[];
  provider?: { name: string; model: string; requestId: string | null };
  lease?: { owner: string; until: number; fence: string };
};
export type EditorialCheckpoint = { state: EditorialState; jobs: Record<string, EditorialJob>; pipeline?: PipelineRevision; pipelineHistory?: PipelineRevision[]; visuals?: { images: LibraryImage[]; banners: BannerDraft[] }; citations?: Citation[]; imageAssets?: ServerImageAsset[]; receipts?: Record<string,{ hash: string; result: unknown; projection?: 'pipeline' }> };
export type ConnectedWorkspace = EditorialCheckpoint & { revision: number; model: string; workerOnline: boolean; stalled?: boolean; deploymentMode?: 'cloud' | 'local'; syncToken?: string };
export type WorkspaceRefresh = ConnectedWorkspace | { unchanged: true; revision: number; syncToken: string; workerOnline: boolean; stalled?: boolean };
