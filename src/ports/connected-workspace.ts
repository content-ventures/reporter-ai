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
import type { FactCheck } from '../domain/fact-check.ts';
import type { ImageAsset } from '../domain/asset.ts';
import type { WorkspaceDelta } from './editorial-rows.ts';
import type { WritingTrace } from '../domain/writing-orchestration.ts';
import type {WorkspaceTemplateConfiguration,WorkspaceTemplateRevision} from '../domain/workspace-templates.ts';

export type ServerImageAsset = { productionId: string; asset: ImageAsset; fileKey?: string };
/** Optional work on a completed text run; never locks editing or changes its outcome. */
export type ArticleImageTask = {
  status: 'queued' | 'completed' | 'skipped' | 'failed';
  revision: number; basedOn: string; hash: string; attempts: number; error?: string;
};
/** The background fact check of a generated article's citations; `done` of them are settled. */
export type FactCheckTask = {
  status: 'queued' | 'completed' | 'failed';
  citationIds: string[]; done: number; attempts: number; error?: string;
};

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
  /** Captured by the server at enqueue; absent only on pre-workspace pilot jobs. */
  context?: { tenant: string; workspace: string; actor: string };
  contextHash?: string;
  /** The immutable render identity used by this carousel, independent of later rebranding. */
  template?: WorkspaceTemplateRevision;
  /** Server-selected retry parent with identical context and immutable prompt snapshot. */
  cacheSourceRunId?: string;
  pipeline?: PipelineRevision;
  calls?: PipelineCall[];
  writingTraces?: WritingTrace[];
  images?: ArticleImageTask;
  factCheck?: FactCheckTask;
  provider?: { name: string; model: string; requestId: string | null };
  lease?: { owner: string; until: number; fence: string };
};
export type EditorialCheckpoint = { state: EditorialState; jobs: Record<string, EditorialJob>; pipeline?: PipelineRevision; pipelineHistory?: PipelineRevision[]; templateConfiguration?:WorkspaceTemplateConfiguration; visuals?: { images: LibraryImage[]; banners: BannerDraft[] }; citations?: Citation[]; factChecks?: FactCheck[]; imageAssets?: ServerImageAsset[]; receipts?: Record<string,{ hash: string; result: unknown; projection?: 'pipeline' }> };
export type WorkspaceNavigation={enabled:boolean;administrative:boolean;accountId:string;view?:import('../domain/member-view.ts').MemberView};
export type ConnectedWorkspace = EditorialCheckpoint & { revision: number; model: string; workerOnline: boolean; stalled?: boolean; deploymentMode?: 'cloud' | 'local'; syncToken?: string;navigation?:WorkspaceNavigation };
/** Rows changed since the browser's change number; the browser merges them into its workspace. */
export type WorkspaceDeltaRefresh = Omit<WorkspaceDelta, 'seq'> & { delta: true; revision: number; syncToken: string; workerOnline: boolean; stalled?: boolean };
export type WorkspaceRefresh = ConnectedWorkspace | WorkspaceDeltaRefresh | { unchanged: true; revision: number; syncToken: string; workerOnline: boolean; stalled?: boolean };
