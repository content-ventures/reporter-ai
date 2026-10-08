import type { ActivityEvent, ActivityType } from '../domain/activity.ts';
import type { ApprovalState, DueState, SendItem } from '../domain/approval.ts';
import type { ImageRef } from '../domain/asset.ts';
import type { CheckResult, Readiness } from '../domain/checks.ts';
import type { Decision, DecisionAnchor, ReviewRequest } from '../domain/decision.ts';
import type { Delivery } from '../domain/delivery.ts';
import type { DiffBlock, DiffChange } from '../domain/diff.ts';
import type { GateId, IsoDateTime, PersonId, PieceId, ProductionId, ReviewRequestId, RunId, SourceId, VersionId } from '../domain/ids.ts';
import type { DeliveryManifest, ExportFile } from '../domain/manifest.ts';
import type { MetricValue, OverviewView } from '../domain/overview.ts';
import type { PieceBody, PieceKind, Version } from '../domain/piece.ts';
import type { SourceRef, SourceVersionRef, VersionRef } from '../domain/refs.ts';
import type { Refusal, Result } from '../domain/result.ts';
import type { ExportItem, ExportRefusal } from '../domain/rules/export.ts';
import type { Freshness } from '../domain/rules/freshness.ts';
import type { PieceStatus, ProductionStatus, ProductionTab } from '../domain/rules/status.ts';
import type { NextStep, Situation } from '../domain/situation.ts';
import type { ArticleSize } from '../domain/sizing.ts';
import type { Source, SourceOrigin, SourceVersion } from '../domain/source.ts';
import type { StageView } from '../domain/stage.ts';
import type { Suggestion } from '../domain/suggestion.ts';
import type { NextAction, PieceView, ProductionView, RunView, SourceSummary, VersionView } from '../domain/views.ts';
import type { ChangeListener, Guard, Lookup, Page, PageRequest, PersonSummary, Unsubscribe } from './common.ts';

/**
 * Read side of the production workflow. Every method returns a READ MODEL built from the
 * domain view builders, so the local simulation and a future server produce the same shapes.
 */

// ── Produções (list) ─────────────────────────────────────────────────────────────────────

export type ListTab = 'all' | ProductionTab;

export type ProductionListFilter = {
  /** Default `all` (every non-archived production). */
  tab?: ListTab;
  /** Matches title, material title and participant names (accent-sensitive, case-insensitive). */
  search?: string;
  ownerIds?: PersonId[];
  origins?: SourceOrigin[];
  /** Last activity inside [from, to] (inclusive). */
  updatedFrom?: IsoDateTime;
  updatedTo?: IsoDateTime;
  /** `urgency`: what waits for a person first (`ProductionListItem.urgency`), then the latest activity. */
  sort?: 'updated_desc' | 'updated_asc' | 'created_desc' | 'title' | 'urgency';
};

export type Participant = {
  label: string;
  person?: PersonSummary;
  /** The person chose "Sem atribuição" for this label (not "sem pessoa"). */
  unattributed?: true;
  segments: number;
  words: number;
};

export type LiveRunSummary = {
  runId: RunId;
  pieceKind?: PieceKind;
  /** "Geração do artigo". */
  label: string;
  /** Current step label and live detail: "Redigindo seção 2 de 3", "42 falas · 3 falantes". */
  step?: string;
  meta?: string;
  progress: { done: number; total: number };
};

export type ProductionListItem = {
  id: ProductionId;
  title: string;
  status: ProductionStatus;
  statusLabel: string;
  tab: ProductionTab;
  stages: StageView[];
  currentStageId: string;
  nextAction: NextAction;
  /** "Situação": "Artigo · Aguardando aprovação de Pedro". */
  situation: Situation;
  /** "Próximo passo" for the acting member (null: nothing for them to do). */
  nextStep: NextStep | null;
  /** `STATUS_URGENCY` of the status (lower = more urgent), for the default sort. */
  urgency: number;
  material?: { sourceId: SourceId; title: string; origin: SourceOrigin; recordedOn?: string; authorized: boolean };
  participants: Participant[];
  /**
   * Readiness of the piece the journey is on (the "Prontidão" meter).
   * @deprecated The list shows `situation` and `nextStep`; removed with the old list.
   */
  readiness?: Readiness & { pieceKind: PieceKind };
  owner: PersonSummary;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  liveRun?: LiveRunSummary;
  archived: boolean;
};

export type ProductionListPage = Page<ProductionListItem> & {
  /** Counts per tab for the current search/filters (tab filter ignored). `all` excludes archived. */
  counts: Record<ListTab, number>;
};

// ── Production header, stepper, hub ──────────────────────────────────────────────────────

export type PieceGuards = {
  generate: Guard;
  saveVersion: Guard;
  requestReview: Guard;
  /** Viewer may approve the version under review (or the latest one). */
  approve: Guard;
  /** Viewer may return the version with a note (the note itself is checked on submit). */
  requestChanges: Guard;
};

export type ProductionGuards = {
  pieces: Partial<Record<PieceKind, PieceGuards>>;
  /** Derivatives in the plan (carousel): may one be created from the latest approved parent? */
  derive: Partial<Record<PieceKind, Guard & { from?: VersionRef }>>;
  export: Guard;
  archive: Guard;
};

// ── Aprovação (D10) ──────────────────────────────────────────────────────────────────────

/** One "Enviar para aprovação" as the screens show it. */
export type ApprovalRequestView = {
  id: ReviewRequestId;
  requester: PersonSummary | null;
  /** "Quem aprova" (null: legacy request, any member with the gate role). */
  assignee: PersonSummary | null;
  requestedAt: IsoDateTime;
  note?: string;
  dueOn?: string;
  due: DueState;
  /** "2º envio" (withdrawn requests do not count). */
  round: number;
  version: VersionView;
  withdrawnAt?: IsoDateTime;
};

export type ApprovalDecisionView = {
  kind: 'approved' | 'changes_requested';
  decider: PersonSummary | null;
  at: IsoDateTime;
  note?: string;
  anchors: DecisionAnchor[];
  version: VersionView;
};

/**
 * Everything the approval UI needs about one piece: its state, the pending request, the latest
 * decision, the pre-send checklist and what the acting member may do.
 */
export type PieceApproval = {
  pieceId: PieceId;
  kind: PieceKind;
  gateId: GateId;
  state: ApprovalState;
  /** The request waiting for a decision (state `awaiting`). */
  request?: ApprovalRequestView;
  /** The latest decision. */
  decision?: ApprovalDecisionView;
  /** What the carousel and the delivery use. */
  approvedVersion?: VersionView;
  /** Every request, oldest first (history drawer). */
  requests: ApprovalRequestView[];
  /** Every decision, oldest first. */
  decisions: ApprovalDecisionView[];
  /** The text waits for a decision: editing is refused until it is withdrawn or decided. */
  locked: boolean;
  send: {
    /** Blocks only when sending is impossible (AI writing, locked, read-only tab, nobody can approve). */
    guard: Guard;
    /** `sendChecklist` on the current draft ("Falta" first, then "Aviso", then the summary). */
    items: SendItem[];
    /** Members with the gate's roles, minus the viewer; the suggested one first. */
    approvers: PersonSummary[];
    /** The last approver of this piece, else of the viewer's last send at this gate. */
    suggestedAssigneeId?: PersonId;
    /** A previous request exists ("Reenviar para …"). */
    isResend: boolean;
  };
  /**
   * canEdit/canSend: editor or admin. canDecide: the gate's role AND not the requester.
   * canWithdraw: requester or admin, while awaiting.
   */
  viewer: { canEdit: boolean; canSend: boolean; canDecide: boolean; canWithdraw: boolean; isRequester: boolean; isAssignee: boolean };
};

export type ProductionDetail = ProductionView & {
  owner: PersonSummary;
  participants: Participant[];
  guards: ProductionGuards;
  /** Approval of each piece that passes a gate. */
  approvals: Partial<Record<PieceKind, PieceApproval>>;
  /** The acting member's next step on this production (null: nothing for them to do). */
  nextStep: NextStep | null;
  /**
   * Characters of the longest article the material supports, when the adapter knows (the
   * simulation never invents more): the brief's size says when the material cannot fill it.
   */
  charsAvailable?: number;
};

// ── Estúdio ──────────────────────────────────────────────────────────────────────────────

export type DraftView = {
  pieceId: PieceId;
  productionId: ProductionId;
  kind: PieceKind;
  body: PieceBody;
  /** Pass back as `baseRevision` on the next saveDraft. */
  revision: number;
  basedOn?: VersionId;
  inputs: VersionRef[];
  sources: SourceVersionRef[];
  updatedAt: IsoDateTime;
  updatedBy: string;
  /** Differs from the latest version (still autosaved in the draft slot). */
  dirty: boolean;
  latestVersion?: VersionView;
  /**
   * AI suggestions on this piece, oldest first, in every state (the studio shows the open ones
   * as cards and decorations, and the decided ones as the record of its copilot turns).
   */
  suggestions: Suggestion[];
  /** Carousel: cover of the article version it was made from (pass `assetId` as `RenderRequest.articleCover`). */
  articleCover?: ImageRef;
};

export type VersionDetail = VersionView & {
  pieceId: PieceId;
  productionId: ProductionId;
  kind: PieceKind;
  body: PieceBody;
  hash: string;
  sources: SourceVersionRef[];
  basedOn?: VersionId;
  author: PersonSummary | null;
  /** The run that produced it (provenance: prompt · model · duration · inputs). */
  run?: RunView;
  /** Carousel: cover of the article version it was made from (pass `assetId` as `RenderRequest.articleCover`). */
  articleCover?: ImageRef;
};

export type CompareView = {
  pieceId: PieceId;
  from: VersionView;
  to: VersionView;
  blocks: DiffBlock[];
  summary: Record<DiffChange, number>;
};

export type SourceDetail = {
  summary: SourceSummary;
  /** Full source with every version (segment ids stable across versions). */
  source: Source;
  /** The version requested (default: current). */
  version: SourceVersion;
  speakers: Participant[];
  productions: { id: ProductionId; title: string }[];
};

// ── Revisão ──────────────────────────────────────────────────────────────────────────────

export type EvidenceView = {
  ref: SourceRef;
  blockIds: string[];
  status: 'used' | 'missing';
  excerpt?: string;
  speaker?: Participant;
};

export type ReviewView = {
  productionId: ProductionId;
  productionTitle: string;
  pieceId: PieceId;
  kind: PieceKind;
  gate: { id: string; label: string };
  status: PieceStatus;
  statusLabel: string;
  version: VersionDetail;
  pendingReview?: ReviewRequest & { requester: PersonSummary | null };
  /** Every "Enviar para aprovação" of this piece, oldest first (decided ones stay in the history). */
  requests?: ReviewRequest[];
  /** Checks evaluated on THIS version's body (what the approver sees). */
  checks: CheckResult[];
  readiness: Readiness;
  /** "Comparar com": the pure AI output and the last approved version, when different. */
  compareWith: { ai?: VersionView; lastApproved?: VersionView };
  evidence: EvidenceView[];
  decisions: (Decision & { decider: PersonSummary | null })[];
  runs: RunView[];
  freshness: Freshness;
  guards: { approve: Guard; requestChanges: Guard };
  approval: PieceApproval;
  /** The version decided before this send ("O que mudou" compares it with the sent one). */
  previous?: { version: VersionView; decision: 'approved' | 'changes_requested'; at: IsoDateTime };
  /** Opens on "O que mudou" when there was a previous decided send. */
  defaultView: 'changes' | 'final';
  /** The viewer's next "Para aprovar" item other than this piece ("Próxima: …"). */
  nextInQueue?: ApprovalItem;
};

// ── Aprovações (`/approvals`) ────────────────────────────────────────────────────────────

export type ApprovalsTab = 'to_approve' | 'approved_by_me' | 'returned';

export type ApprovalItem = {
  productionId: ProductionId;
  productionTitle: string;
  pieceId: PieceId;
  kind: PieceKind;
  pieceLabel: string;
  requester: PersonSummary | null;
  requestedAt: IsoDateTime;
  note?: string;
  dueOn?: string;
  due: DueState;
  round: number;
  /** Article: its size and length ("1,4 de 2 laudas"). */
  characters?: number;
  size?: ArticleSize;
  /** Carousel: "5 slides". */
  slides?: number;
  /** "Aprovadas por mim" / "Devolvidas": the viewer's decision. */
  decision?: 'approved' | 'changes_requested';
  decidedAt?: IsoDateTime;
  decisionNote?: string;
};

/**
 * `to_approve`: pending requests assigned to the viewer (or unassigned and the viewer has the gate
 * role), never the viewer's own sends; overdue, today, later, no due date, then oldest first.
 * `approved_by_me` / `returned`: the viewer's decisions, newest first, at most 50.
 */
export type ApprovalsPage = { tab: ApprovalsTab; items: ApprovalItem[]; counts: Record<ApprovalsTab, number> };

// ── Entrega ──────────────────────────────────────────────────────────────────────────────

export type DeliveryItemView = ExportItem & {
  label: string;
  versionView: VersionView;
  approvedBy: PersonSummary | null;
  approvedAt?: IsoDateTime;
  templateId?: string;
};

export type DeliveryQuery = {
  /** Preview another package (e.g. "Exportar com artigo v4"); default: latest approved of each piece. */
  selection?: VersionRef[];
};

export type DeliveryView = {
  productionId: ProductionId;
  productionTitle: string;
  stage?: StageView;
  /** False while a planned piece has no approved version (stage blocked). */
  available: boolean;
  blockedReason?: string;
  selection: VersionRef[];
  result: Result<ExportItem[], ExportRefusal>;
  /** The consistent alternatives offered when the package mixes versions. */
  alternatives: {
    exportWithParent?: { selection: VersionRef[]; label: string };
    updateDerivative?: { pieceId: PieceId; kind: PieceKind; label: string };
  };
  items: DeliveryItemView[];
  /**
   * The approved article of the selection, read as it leaves ("Artigo final") — present even while
   * the package cannot be built (a carousel made from an older version of it).
   */
  article?: DeliveryItemView;
  files: ExportFile[];
  manifest?: DeliveryManifest;
  provenance: {
    sources: { id: SourceId; title: string; version: number; hash: string; shortHash: string }[];
    runs: RunView[];
  };
  latestDelivery?: Delivery;
  delivered: boolean;
  /** Automatic timings for the pilot feedback (ms per stage id, e.g. `article`, `carousel`, `delivery`). */
  stageDurations: Record<string, number>;
};

// ── Início ("Minha mesa", D1) ────────────────────────────────────────────────────────────

export type DeskGroupId = 'to_approve' | 'returned' | 'failed' | 'unauthorized' | 'waiting_other';

export type DeskItem = {
  productionId: ProductionId;
  productionTitle: string;
  pieceId?: PieceId;
  kind?: PieceKind;
  pieceLabel?: string;
  status: PieceStatus | 'unauthorized';
  /** Who asked, who returned it, or who started the failed generation. */
  from: PersonSummary | null;
  at?: IsoDateTime;
  note?: string;
  dueOn?: string;
  due: DueState;
  /** `waiting_other`: who has it now. */
  withPerson?: PersonSummary | null;
  /** `failed`: the part where the AI stopped ("parte 2 de 4"). */
  progress?: { current: number; total: number };
  /** Null for `waiting_other` (no button). */
  nextStep: NextStep | null;
};

export type DeskGroup = { id: DeskGroupId; items: DeskItem[] };

export type InProgressItem = {
  productionId: ProductionId;
  productionTitle: string;
  situation: Situation;
  characters?: number;
  size?: ArticleSize;
  owner: PersonSummary;
  updatedAt: IsoDateTime;
  nextStep: NextStep | null;
};

/** "Equipe" groups: Material · Escrevendo · Aprovação · Carrossel · Entrega. */
export type TeamStage = 'material' | 'writing' | 'approval' | 'carousel' | 'delivery';

export type DeskView = {
  /** Non-empty groups only, in order: to_approve, returned, failed, unauthorized, waiting_other. */
  groups: DeskGroup[];
  /** Items in every group except `waiting_other` (agrees with the menu's "Aprovações N" for approvers). */
  needsYou: number;
  /** The viewer's own active productions not in a group (everyone's when they own none); max 6, newest first. */
  inProgress: InProgressItem[];
  inProgressTotal: number;
  /** "Equipe": every production not archived, by stage (delivered ones under Entrega); all five stages, empty ones included. */
  team: { stage: TeamStage; items: InProgressItem[] }[];
  /** "Esta semana: 8 em produção · 14 aprovadas · 4,5 h até aprovar" for the selected range. */
  week: { inProduction: number; approved: number | null; timeToApprovalMs: number | null };
  /** The wide "Continuar" card of the empty queue: the viewer's own next move (absent when nothing is theirs). */
  continueWith?: InProgressItem;
};

// ── Visão geral ──────────────────────────────────────────────────────────────────────────

export type OverviewRange = '7d' | '30d';

export type MetricWithDelta = MetricValue & {
  /** value − previous, when both exist. */
  delta: number | null;
  /** Whether the change is good news (time-to-approval improves when it falls). */
  trend: 'better' | 'worse' | 'flat' | 'unknown';
};

export type AwaitingItem = {
  productionId: ProductionId;
  productionTitle: string;
  pieceId: PieceId;
  kind: PieceKind;
  pieceLabel: string;
  /** `failed`: the piece's generation failed before writing anything (red "Erro" + "Tentar de novo"). */
  reason: 'review' | 'changes_requested' | 'failed';
  version?: VersionView;
  /** Who sent it to review, who returned it, or who started the failed generation. */
  from: PersonSummary | null;
  at?: IsoDateTime;
  note?: string;
};

export type ActivityItem = ActivityEvent & {
  actor: PersonSummary | null;
  productionTitle?: string;
  /** Ready-to-show pt-BR line: "Pedro Alves aprovou o artigo v4". */
  summary: string;
};

export type OverviewData = Omit<OverviewView, 'metrics' | 'awaitingYou' | 'activity'> & {
  range: OverviewRange;
  metrics: {
    inProduction: number;
    generatingNow: number;
    awaitingApproval: number;
    approved: MetricWithDelta;
    timeToApprovalMs: MetricWithDelta;
    aiRetention: MetricWithDelta;
  };
  /** Readiness of `continueWith`'s current piece (MeterList). */
  continueReadiness?: { pieceKind: PieceKind; checks: CheckResult[]; readiness: Readiness };
  awaitingYou: AwaitingItem[];
  activity: ActivityItem[];
  /** No productions at all: show the EmptyState with "Nova produção" and "Carregar exemplo". */
  empty: boolean;
  /** Início (D1): the viewer's queue, work in progress, the team by stage and the week line. */
  desk: DeskView;
};

export type ActivityQuery = {
  productionId?: ProductionId;
  types?: ActivityType[];
} & Partial<PageRequest>;

// ── Port ─────────────────────────────────────────────────────────────────────────────────

export interface ProductionQueries {
  list(filter?: ProductionListFilter, page?: Partial<PageRequest>): Promise<ProductionListPage>;
  get(productionId: ProductionId): Promise<Lookup<ProductionDetail>>;
  overview(range: OverviewRange): Promise<OverviewData>;
  /** Newest first. Only semantic events (never keystrokes or autosaves). */
  activity(query?: ActivityQuery): Promise<Page<ActivityItem>>;
  /** Everyone the workspace knows: members and interviewees (speaker mapping, avatars). */
  people(): Promise<PersonSummary[]>;
  draft(pieceId: PieceId): Promise<Lookup<DraftView>>;
  version(versionId: VersionId): Promise<Lookup<VersionDetail>>;
  compare(pieceId: PieceId, fromVersionId: VersionId, toVersionId: VersionId): Promise<Lookup<CompareView>>;
  source(sourceId: SourceId, version?: number): Promise<Lookup<SourceDetail>>;
  /** Review surface for a version (default: the one under review, else the latest). */
  review(pieceId: PieceId, versionId?: VersionId): Promise<Lookup<ReviewView>>;
  delivery(productionId: ProductionId, query?: DeliveryQuery): Promise<Lookup<DeliveryView>>;
  /** "Aprovações": the acting member's queue and decisions (empty for members who cannot decide). */
  approvals(tab: ApprovalsTab): Promise<ApprovalsPage>;
  /** Called after any change; refetch what the notice touches. */
  subscribe(listener: ChangeListener): Unsubscribe;
}

/** Narrow re-exports so screens import read models from one place. */
export type { PieceView, ProductionView, RunView, SourceSummary, Version, VersionView, Refusal };
