import type { ArticleBody } from '../../../domain/article.ts';
import { withApprovedRights } from '../../../domain/asset.ts';
import { readiness } from '../../../domain/checks.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import { diffArticles, diffCarousels, diffSummary } from '../../../domain/diff.ts';
import type { DiffBlock } from '../../../domain/diff.ts';
import type { PieceId, SourceId, VersionId } from '../../../domain/ids.ts';
import type { Version } from '../../../domain/piece.ts';
import { carouselArticleCover, decidedImageRights, findPiece, findVersion, latestApproved, latestVersion, pendingReview, pieceDecisions, runsOf, versionsOf } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { refKey } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { ok, refuse } from '../../../domain/result.ts';
import { freshnessLookup, versionFreshness } from '../../../domain/rules/freshness.ts';
import { isDraftDirty } from '../../../domain/rules/versions.ts';
import { PIECE_STATUS_LABELS, pieceStatus } from '../../../domain/rules/status.ts';
import { currentSourceVersion, resolveSourceRef, sourceVersion } from '../../../domain/source.ts';
import { evaluatePieceChecks, toRunView, toSourceSummary, toVersionView } from '../../../domain/views.ts';
import type { Lookup } from '../../../ports/common.ts';
import type {
  CompareView,
  DraftView,
  EvidenceView,
  ReviewView,
  SourceDetail,
  VersionDetail,
} from '../../../ports/production-queries.ts';
import { decisionGuard, reviewSubject } from './guards.ts';
import { participantsOf, personOf } from './people.ts';
import { materialCharsOf, recordOf, viewOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';
import { locatePiece, locateVersion, productionsUsingSource } from './state.ts';
import { pieceApproval } from './views-approval.ts';
import { toApproveItems } from './views-queue.ts';

/** Studio, version history, comparison, material and review read models. */

const NOT_FOUND = refuse('not_found', 'Não encontramos este item.');

export function draftView(ctx: ReadContext, pieceId: PieceId): Lookup<DraftView> {
  const location = locatePiece(ctx.state, pieceId);
  if (!location) return NOT_FOUND;
  const record = recordOf(ctx, location.production);
  const { piece } = location;
  const latest = latestVersion(record, piece.id);
  const view: DraftView = {
    pieceId: piece.id,
    productionId: piece.productionId,
    kind: piece.kind,
    body: piece.draft.body,
    revision: piece.draft.revision,
    inputs: piece.draft.inputs,
    sources: piece.draft.sources,
    updatedAt: piece.draft.updatedAt,
    updatedBy: piece.draft.updatedBy,
    dirty: isDraftDirty(piece, latest),
    suggestions: record.suggestions
      .filter((suggestion) => suggestion.pieceId === piece.id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  };
  if (piece.draft.basedOn) view.basedOn = piece.draft.basedOn;
  if (latest) view.latestVersion = toVersionView(record, latest);
  const cover = piece.kind === 'carousel' ? carouselArticleCover(record, piece.draft.inputs) : undefined;
  if (cover) view.articleCover = cover;
  return ok(view);
}

export function toVersionDetail(ctx: ReadContext, record: ProductionRecord, version: Version): VersionDetail {
  const piece = findPiece(record, version.pieceId);
  const detail: VersionDetail = {
    ...toVersionView(record, version),
    pieceId: version.pieceId,
    productionId: record.production.id,
    kind: piece?.kind ?? version.body.type,
    body: version.body,
    hash: version.hash,
    sources: version.sources,
    author: personOf(ctx.state, version.createdBy),
  };
  if (version.basedOn) detail.basedOn = version.basedOn;
  const run = version.runId ? record.runs.find((entry) => entry.id === version.runId) : undefined;
  if (run) detail.run = toRunView(run, ctx.now);
  const cover = version.body.type === 'carousel' ? carouselArticleCover(record, version.inputs) : undefined;
  if (cover) detail.articleCover = cover;
  return detail;
}

export function versionDetail(ctx: ReadContext, versionId: VersionId): Lookup<VersionDetail> {
  const location = locateVersion(ctx.state, versionId);
  if (!location) return NOT_FOUND;
  return ok(toVersionDetail(ctx, recordOf(ctx, location.production), location.version));
}

export function compareVersions(ctx: ReadContext, pieceId: PieceId, fromId: VersionId, toId: VersionId): Lookup<CompareView> {
  const location = locatePiece(ctx.state, pieceId);
  if (!location) return NOT_FOUND;
  const record = recordOf(ctx, location.production);
  const versions = versionsOf(record, pieceId);
  const from = versions.find((version) => version.id === fromId);
  const to = versions.find((version) => version.id === toId);
  if (!from || !to) return NOT_FOUND;
  let blocks: DiffBlock[];
  if (from.body.type === 'article' && to.body.type === 'article') {
    // The older version reads its images as decided (credit and rights changed since show as changes).
    blocks = diffArticles(from.body, to.body, { assets: ctx.assets, beforeAssets: withApprovedRights(ctx.assets, decidedImageRights(record, from)) });
  }
  else if (from.body.type === 'carousel' && to.body.type === 'carousel') {
    const templateId = to.body.templateId;
    blocks = diffCarousels(from.body, to.body, ctx.templates.find((template) => template.id === templateId));
  } else return NOT_FOUND;
  return ok({ pieceId, from: toVersionView(record, from), to: toVersionView(record, to), blocks, summary: diffSummary(blocks) });
}

export function sourceDetail(ctx: ReadContext, sourceId: SourceId, versionNumber?: number): Lookup<SourceDetail> {
  const source = ctx.state.sources.find((candidate) => candidate.id === sourceId);
  if (!source) return NOT_FOUND;
  const version = versionNumber === undefined ? currentSourceVersion(source) : sourceVersion(source, versionNumber);
  if (!version) return NOT_FOUND;
  return ok({
    summary: toSourceSummary(source),
    source,
    version,
    speakers: participantsOf(ctx.state, { sources: [source] }),
    productions: productionsUsingSource(ctx.state, sourceId).map((entry) => ({ id: entry.production.id, title: entry.production.title })),
  });
}

function evidenceOf(ctx: ReadContext, record: ProductionRecord, body: ArticleBody): EvidenceView[] {
  const participants = participantsOf(ctx.state, record);
  const byRef = new Map<string, EvidenceView>();
  for (const block of body.blocks) {
    for (const ref of block.sourceRefs ?? []) {
      const key = refKey(ref);
      const existing = byRef.get(key);
      if (existing) {
        existing.blockIds.push(block.id);
        continue;
      }
      byRef.set(key, evidenceEntry(record, participants, ref, block.id));
    }
  }
  return [...byRef.values()];
}

function evidenceEntry(record: ProductionRecord, participants: ReturnType<typeof participantsOf>, ref: SourceRef, blockId: string): EvidenceView {
  const resolved = resolveSourceRef(record.sources, ref);
  if (!resolved) return { ref, blockIds: [blockId], status: 'missing' };
  const entry: EvidenceView = { ref, blockIds: [blockId], status: 'used', excerpt: resolved.excerpt };
  const speaker = resolved.segment?.speaker ? participants.find((participant) => participant.label === resolved.segment?.speaker) : undefined;
  if (speaker) entry.speaker = speaker;
  return entry;
}

export function reviewView(ctx: ReadContext, pieceId: PieceId, versionId?: VersionId): Lookup<ReviewView> {
  const location = locatePiece(ctx.state, pieceId);
  if (!location) return NOT_FOUND;
  const record = recordOf(ctx, location.production);
  const { piece } = location;
  const version = versionId ? versionsOf(record, pieceId).find((entry) => entry.id === versionId) : reviewSubject(record, piece);
  if (!version) return NOT_FOUND;
  const gate = gateForPiece(piece.kind, ctx.gates);
  const checks = evaluatePieceChecks(record, piece, version.body, ctx.templates, ctx.assets, materialCharsOf(record));
  const status = pieceStatus(record, piece.kind);
  const all = versionsOf(record, pieceId);
  // The AI output this version descends from: the latest generation up to it ("Gerar nova versão"
  // starts a new lineage, so v1 · IA is not the baseline of a draft made from v3 · IA).
  const ai = all.filter((entry) => entry.origin === 'generation' && entry.number <= version.number).pop();
  const approved = latestApproved(record, pieceId);
  const approval = pieceApproval(ctx, record, piece, viewOf(ctx, location.production, record));
  if (!approval) return NOT_FOUND;
  const view: ReviewView = {
    productionId: record.production.id,
    productionTitle: record.production.title,
    pieceId,
    kind: piece.kind,
    gate: gate ? { id: gate.id, label: gate.label } : { id: '', label: '' },
    status,
    statusLabel: PIECE_STATUS_LABELS[status],
    version: toVersionDetail(ctx, record, version),
    checks,
    readiness: readiness(checks),
    compareWith: {},
    evidence: version.body.type === 'article' ? evidenceOf(ctx, record, version.body) : [],
    decisions: pieceDecisions(record, pieceId).map((decision) => ({ ...decision, decider: personOf(ctx.state, decision.by) })),
    runs: runsOf(record, pieceId).map((run) => toRunView(run, ctx.now)),
    freshness: versionFreshness(version, freshnessLookup(record)),
    guards: {
      approve: decisionGuard(ctx, record, piece, version, 'approved'),
      requestChanges: decisionGuard(ctx, record, piece, version, 'changes_requested'),
    },
    approval,
    defaultView: 'final',
  };
  // "O que mudou": the version decided before this send (opens there when it exists).
  const sentAt = record.reviewRequests
    .filter((entry) => entry.subject.versionId === version.id && entry.withdrawnAt === undefined)
    .map((entry) => entry.requestedAt)
    .sort()
    .pop();
  const before = pieceDecisions(record, pieceId)
    .filter((decision) => decision.subject.kind === 'version' && decision.subject.versionId !== version.id)
    .filter((decision) => decision.decision === 'approved' || decision.decision === 'changes_requested')
    .filter((decision) => Date.parse(decision.at) <= Date.parse(sentAt ?? version.createdAt))
    .pop();
  const beforeVersion = before?.subject.kind === 'version' ? findVersion(record, before.subject.versionId) : undefined;
  if (before && beforeVersion && (before.decision === 'approved' || before.decision === 'changes_requested')) {
    view.previous = { version: toVersionView(record, beforeVersion), decision: before.decision, at: before.at };
    view.defaultView = 'changes';
  }
  const next = toApproveItems(ctx).find((item) => item.pieceId !== pieceId);
  if (next) view.nextInQueue = next;
  if (ai && ai.id !== version.id) view.compareWith.ai = toVersionView(record, ai);
  if (approved && approved.version.id !== version.id) view.compareWith.lastApproved = toVersionView(record, approved.version);
  const request = pendingReview(record, pieceId);
  if (request) view.pendingReview = { ...request, requester: personOf(ctx.state, request.requestedBy) };
  view.requests = record.reviewRequests
    .filter((entry) => entry.subject.pieceId === pieceId)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return ok(view);
}
