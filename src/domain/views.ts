import { articleStats, unreviewedAiBlockIds } from './article.ts';
import type { AssetLookup } from './asset.ts';
import type { CarouselTemplate } from './carousel.ts';
import { ARTICLE_CHECKS, CAROUSEL_CHECKS, readiness, runChecks } from './checks.ts';
import type { CheckResult, GenerationState, Readiness } from './checks.ts';
import type { Decision, DecisionKind, ReviewRequest } from './decision.ts';
import type { Delivery } from './delivery.ts';
import type { ActorId, IsoDateTime, PersonId, PieceId, ProductionId, RunId, SourceId, VersionId } from './ids.ts';
import { bodyHash, PIECE_LABELS, toVersionRef, versionLabel } from './piece.ts';
import type { Piece, PieceBody, PieceKind, Version, VersionOrigin } from './piece.ts';
import type { Brief, Production } from './production.ts';
import {
  activeRun,
  carouselArticleCover,
  lastActivityAt,
  lastRun,
  latestApproved,
  latestDecisionOn,
  latestDelivery,
  latestVersion,
  pendingReview,
  pendingSuggestions,
  pieceDecisions,
  pieceOfKind,
  runsOf,
  versionsOf,
} from './record.ts';
import type { ProductionRecord } from './record.ts';
import type { VersionRef } from './refs.ts';
import { freshnessMessage, pieceFreshness } from './rules/freshness.ts';
import type { Freshness } from './rules/freshness.ts';
import { PIECE_STATUS_LABELS, PRODUCTION_STATUS_LABELS, pieceStatus } from './rules/status.ts';
import type { PieceStatus, ProductionStatus } from './rules/status.ts';
import { currentStep, isRunActive, RUN_KIND_LABELS, runDurationMs, stepProgress } from './run.ts';
import type { GenerationRun, RunStep } from './run.ts';
import { currentSourceVersion } from './source.ts';
import type { Source, SourceKind, SourceOrigin, Speaker } from './source.ts';
import { stageState } from './stage.ts';
import type { FlowDefinition, StageView } from './stage.ts';
import { shortHash } from './text/hash.ts';
import { analyzeTranscript } from './text/transcript-parse.ts';

/**
 * Read models returned by the ports. Pure builders over a ProductionRecord, so the local
 * adapter and a future remote adapter produce identical shapes for the screens.
 */

export type ViewOptions = {
  now: IsoDateTime;
  templates?: readonly CarouselTemplate[];
  flow?: FlowDefinition;
  /** Image metadata for the image checks (credit, rights). */
  assets?: AssetLookup;
};

export type VersionView = {
  id: VersionId;
  ref: VersionRef;
  number: number;
  /** "v1 · IA", "v4 · restaurada da v2". */
  label: string;
  origin: VersionOrigin;
  createdAt: IsoDateTime;
  createdBy: ActorId;
  runId?: RunId;
  interrupted: boolean;
  words: number;
  inputs: VersionRef[];
  restoredFrom?: VersionId;
  /** Latest decision on this exact version. */
  decision?: { kind: DecisionKind; by: PersonId; at: IsoDateTime; id: string };
  isLatest: boolean;
  /** This is the piece's current approved version. */
  isCurrentApproved: boolean;
};

export type RunView = GenerationRun & {
  label: string;
  durationMs?: number;
  progress: { done: number; total: number };
  current?: RunStep;
};

export type PieceView = {
  id: PieceId;
  kind: PieceKind;
  slug: string;
  label: string;
  status: PieceStatus;
  statusLabel: string;
  freshness: Freshness;
  /** Amber alert text when stale ("O artigo aprovado mudou para a versão 5."). */
  staleMessage?: string;
  draft: {
    revision: number;
    updatedAt: IsoDateTime;
    updatedBy: ActorId;
    basedOn?: VersionId;
    /** Draft differs from the latest version (unsaved as a version, still autosaved). */
    dirty: boolean;
    words: number;
    unreviewedAiBlocks: number;
  };
  versions: VersionView[];
  latestVersion?: VersionView;
  approvedVersion?: VersionView;
  pendingReview?: ReviewRequest;
  lastDecision?: Decision;
  activeRun?: RunView;
  lastRun?: RunView;
  pendingSuggestions: number;
  checks: CheckResult[];
  readiness: Readiness;
};

export type SourceSummary = {
  id: SourceId;
  kind: SourceKind;
  title: string;
  origin: SourceOrigin;
  recordedOn?: string;
  version: number;
  hash: string;
  shortHash: string;
  words: number;
  readingMinutes: number;
  segments: number;
  speakers: (Speaker & { segments: number; words: number })[];
  hasTimestamps: boolean;
  durationMs?: number;
  authorized: boolean;
};

export type NextActionKind = 'authorize' | 'generate' | 'continue' | 'review' | 'fix' | 'derive' | 'update' | 'export' | 'wait' | 'done';

export type NextAction = { kind: NextActionKind; label: string; stageId: string; pieceKind?: PieceKind };

export type ProductionView = {
  id: ProductionId;
  title: string;
  flowId: string;
  status: ProductionStatus;
  statusLabel: string;
  stages: StageView[];
  currentStageId: string;
  nextAction: NextAction;
  pieces: PieceView[];
  sources: SourceSummary[];
  brief: Brief;
  plan: PieceKind[];
  ownerId: PersonId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  activeRuns: RunView[];
  runs: RunView[];
  latestDelivery?: Delivery;
  production: Production;
};

export function toRunView(run: GenerationRun, now?: IsoDateTime): RunView {
  const view: RunView = { ...run, label: RUN_KIND_LABELS[run.kind], progress: stepProgress(run) };
  const durationMs = runDurationMs(run, isRunActive(run) ? now : undefined);
  if (durationMs !== undefined) view.durationMs = durationMs;
  const step = currentStep(run);
  if (step) view.current = step;
  return view;
}

function bodyWords(body: PieceBody): number {
  if (body.type === 'article') return articleStats(body).words;
  return body.slides.reduce((total, slide) => total + Object.values(slide.slots).join(' ').split(/\s+/).filter(Boolean).length, 0);
}

export function toVersionView(record: ProductionRecord, version: Version): VersionView {
  const all = versionsOf(record, version.pieceId);
  const ref = toVersionRef(version);
  const decision = latestDecisionOn(record, ref);
  const approved = latestApproved(record, version.pieceId);
  const view: VersionView = {
    id: version.id,
    ref,
    number: version.number,
    label: versionLabel(version, all),
    origin: version.origin,
    createdAt: version.createdAt,
    createdBy: version.createdBy,
    interrupted: version.interrupted === true,
    words: bodyWords(version.body),
    inputs: version.inputs,
    isLatest: all[all.length - 1]?.id === version.id,
    isCurrentApproved: approved?.version.id === version.id,
  };
  if (version.runId) view.runId = version.runId;
  if (version.restoredFrom) view.restoredFrom = version.restoredFrom;
  if (decision) view.decision = { kind: decision.decision, by: decision.by, at: decision.at, id: decision.id };
  return view;
}

/** Generation state for the "Geração concluída" check of a given body. */
export function generationStateFor(record: ProductionRecord, piece: Piece, body: PieceBody): GenerationState {
  const running = activeRun(record, piece.id) !== undefined;
  const hash = bodyHash(body);
  const interrupted = versionsOf(record, piece.id).some((version) => version.interrupted && version.hash === hash);
  return { running, interrupted };
}

/** Readiness checks for any body of a piece (the draft in the studio, a version in review). */
export function evaluatePieceChecks(
  record: ProductionRecord,
  piece: Piece,
  body: PieceBody = piece.draft.body,
  templates: readonly CarouselTemplate[] = [],
  assets?: AssetLookup,
): CheckResult[] {
  const generation = generationStateFor(record, piece, body);
  if (body.type === 'article') {
    return runChecks(ARTICLE_CHECKS, { body, brief: record.production.brief, sources: record.sources, generation, ...(assets ? { assets } : {}) });
  }
  const template = templates.find((candidate) => candidate.id === body.templateId);
  const article = pieceOfKind(record, 'article');
  const latestParent = article ? latestApproved(record, article.id)?.ref : undefined;
  const inputs = versionsOf(record, piece.id).find((version) => version.hash === bodyHash(body))?.inputs ?? piece.draft.inputs;
  // The cover the slides are drawn with: the draft's own article version (a rebased draft may
  // still read as an older version's text), or the version's.
  const articleCover = carouselArticleCover(record, body === piece.draft.body ? piece.draft.inputs : inputs);
  return runChecks(CAROUSEL_CHECKS, {
    body,
    ...(template ? { template } : {}),
    inputs,
    ...(latestParent ? { latestApprovedParent: latestParent } : {}),
    generation,
    ...(articleCover ? { articleCover } : {}),
    ...(assets ? { assets } : {}),
  });
}

export function buildPieceView(record: ProductionRecord, kind: PieceKind, options: ViewOptions): PieceView | undefined {
  const piece = pieceOfKind(record, kind);
  if (!piece) return undefined;
  const versions = versionsOf(record, piece.id).map((version) => toVersionView(record, version));
  const latest = latestVersion(record, piece.id);
  const approved = latestApproved(record, piece.id);
  const status = pieceStatus(record, kind);
  const freshness = pieceFreshness(record, piece.id);
  const decisions = pieceDecisions(record, piece.id);
  const checks = evaluatePieceChecks(record, piece, piece.draft.body, options.templates, options.assets);
  const view: PieceView = {
    id: piece.id,
    kind,
    slug: piece.slug,
    label: PIECE_LABELS[kind],
    status,
    statusLabel: PIECE_STATUS_LABELS[status],
    freshness,
    draft: {
      revision: piece.draft.revision,
      updatedAt: piece.draft.updatedAt,
      updatedBy: piece.draft.updatedBy,
      dirty: latest ? bodyHash(piece.draft.body) !== latest.hash : bodyWords(piece.draft.body) > 0,
      words: bodyWords(piece.draft.body),
      unreviewedAiBlocks: piece.draft.body.type === 'article' ? unreviewedAiBlockIds(piece.draft.body).length : 0,
    },
    versions,
    pendingSuggestions: pendingSuggestions(record, piece.id).length,
    checks,
    readiness: readiness(checks),
  };
  if (piece.draft.basedOn) view.draft.basedOn = piece.draft.basedOn;
  const staleMessage = freshnessMessage(freshness, kind === 'carousel' ? 'artigo' : 'conteúdo de origem');
  if (staleMessage) view.staleMessage = staleMessage;
  if (latest) view.latestVersion = versions[versions.length - 1];
  if (approved) view.approvedVersion = versions.find((entry) => entry.id === approved.version.id);
  const review = pendingReview(record, piece.id);
  if (review) view.pendingReview = review;
  const lastDecision = decisions[decisions.length - 1];
  if (lastDecision) view.lastDecision = lastDecision;
  const active = activeRun(record, piece.id);
  if (active) view.activeRun = toRunView(active, options.now);
  const last = lastRun(record, piece.id);
  if (last) view.lastRun = toRunView(last, options.now);
  return view;
}

export function toSourceSummary(source: Source): SourceSummary {
  const version = currentSourceVersion(source);
  const analysis = analyzeTranscript(version.content.segments);
  const summary: SourceSummary = {
    id: source.id,
    kind: source.kind,
    title: source.title,
    origin: source.origin,
    version: version.number,
    hash: version.hash,
    shortHash: shortHash(version.hash),
    words: analysis.words,
    readingMinutes: analysis.readingMinutes,
    segments: analysis.segments,
    speakers: source.speakers.map((speaker) => {
      const stats = analysis.speakers.find((entry) => entry.label === speaker.label);
      return { ...speaker, segments: stats?.segments ?? 0, words: stats?.words ?? 0 };
    }),
    hasTimestamps: analysis.hasTimestamps,
    authorized: source.rights.authorized,
  };
  if (source.recordedOn) summary.recordedOn = source.recordedOn;
  if (analysis.durationMs !== undefined) summary.durationMs = analysis.durationMs;
  return summary;
}

/** What to do next, for "Continue de onde parou", board cards and the hub. */
export function nextAction(record: ProductionRecord, pieces: readonly PieceView[], stages: readonly StageView[]): NextAction {
  if (record.sources.length > 0 && record.sources.some((source) => !source.rights.authorized)) {
    return { kind: 'authorize', label: 'Autorizar material', stageId: 'source' };
  }
  for (const kind of record.production.plan) {
    const piece = pieces.find((entry) => entry.kind === kind);
    const label = PIECE_LABELS[kind].toLowerCase();
    const stageId = stages.find((stage) => stage.pieceKind === kind)?.id ?? kind;
    if (!piece || piece.status === 'not_started') {
      return kind === 'article'
        ? { kind: 'generate', label: 'Gerar artigo', stageId, pieceKind: kind }
        : { kind: 'derive', label: `Gerar ${label}`, stageId, pieceKind: kind };
    }
    switch (piece.status) {
      case 'locked':
        return { kind: 'wait', label: `Aguardando aprovação`, stageId, pieceKind: kind };
      case 'generating':
        return { kind: 'wait', label: `Gerando ${label}`, stageId, pieceKind: kind };
      case 'failed':
        return { kind: 'fix', label: 'Tentar de novo', stageId, pieceKind: kind };
      case 'draft':
        return { kind: 'continue', label: `Continuar ${label}`, stageId, pieceKind: kind };
      case 'in_review':
        return { kind: 'review', label: `Aprovar ${label}`, stageId, pieceKind: kind };
      case 'changes_requested':
        return { kind: 'fix', label: `Ajustar ${label}`, stageId, pieceKind: kind };
      case 'stale':
        return { kind: 'update', label: `Atualizar ${label}`, stageId, pieceKind: kind };
      case 'approved':
        continue;
    }
  }
  const delivery = stages.find((stage) => stage.kind === 'delivery');
  if (delivery && delivery.status !== 'completed') return { kind: 'export', label: 'Exportar pacote', stageId: delivery.id };
  return { kind: 'done', label: 'Concluída', stageId: delivery?.id ?? 'delivery' };
}

export function buildProductionView(record: ProductionRecord, options: ViewOptions): ProductionView {
  const journey = stageState(record, options.flow);
  const pieces = record.production.plan
    .map((kind) => buildPieceView(record, kind, options))
    .filter((view): view is PieceView => view !== undefined);
  const runs = runsOf(record).map((run) => toRunView(run, options.now));
  const view: ProductionView = {
    id: record.production.id,
    title: record.production.title,
    flowId: record.production.flowId,
    status: journey.status,
    statusLabel: PRODUCTION_STATUS_LABELS[journey.status],
    stages: journey.stages,
    currentStageId: journey.currentStageId,
    nextAction: nextAction(record, pieces, journey.stages),
    pieces,
    sources: record.sources.map(toSourceSummary),
    brief: record.production.brief,
    plan: record.production.plan,
    ownerId: record.production.ownerId,
    createdAt: record.production.createdAt,
    updatedAt: lastActivityAt(record),
    activeRuns: runs.filter((run) => isRunActive(run) && !run.parentRunId),
    runs,
    production: record.production,
  };
  const delivery = latestDelivery(record);
  if (delivery) view.latestDelivery = delivery;
  return view;
}
