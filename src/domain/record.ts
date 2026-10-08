import { articleAssetIds } from './article.ts';
import type { ImageRef, ImageRightsRecord } from './asset.ts';
import type { Decision, ReviewRequest } from './decision.ts';
import type { Delivery } from './delivery.ts';
import type { AssetId, PieceId, VersionId } from './ids.ts';
import type { Piece, PieceKind, Version } from './piece.ts';
import { toVersionRef } from './piece.ts';
import type { Production } from './production.ts';
import { sameVersionRef } from './refs.ts';
import type { SourceVersionRef, VersionRef } from './refs.ts';
import { isRunActive } from './run.ts';
import type { GenerationRun } from './run.ts';
import { currentSourceVersion, toSourceVersionRef } from './source.ts';
import type { Source } from './source.ts';
import { isSuggestionPending } from './suggestion.ts';
import type { Suggestion } from './suggestion.ts';

/**
 * Normalised snapshot of one production and everything that hangs off it. Rules and view
 * builders read this shape; the local adapter stores it, a remote adapter can assemble it.
 */
export type ProductionRecord = {
  production: Production;
  sources: Source[];
  pieces: Piece[];
  versions: Version[];
  decisions: Decision[];
  reviewRequests: ReviewRequest[];
  runs: GenerationRun[];
  suggestions: Suggestion[];
  deliveries: Delivery[];
};

function byTime<T>(get: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => Date.parse(get(a)) - Date.parse(get(b));
}

export function pieceOfKind(record: Pick<ProductionRecord, 'pieces'>, kind: PieceKind): Piece | undefined {
  return record.pieces.find((piece) => piece.kind === kind);
}

export function findPiece(record: Pick<ProductionRecord, 'pieces'>, pieceId: PieceId): Piece | undefined {
  return record.pieces.find((piece) => piece.id === pieceId);
}

/** Versions of a piece, ascending by number. */
export function versionsOf(record: Pick<ProductionRecord, 'versions'>, pieceId: PieceId): Version[] {
  return record.versions.filter((version) => version.pieceId === pieceId).sort((a, b) => a.number - b.number);
}

export function latestVersion(record: Pick<ProductionRecord, 'versions'>, pieceId: PieceId): Version | undefined {
  const versions = versionsOf(record, pieceId);
  return versions[versions.length - 1];
}

export function findVersion(record: Pick<ProductionRecord, 'versions'>, versionId: VersionId): Version | undefined {
  return record.versions.find((version) => version.id === versionId);
}

/** Decisions whose subject is this exact version (id + hash), oldest first. */
export function decisionsOn(record: Pick<ProductionRecord, 'decisions'>, ref: VersionRef): Decision[] {
  return record.decisions
    .filter((decision) => decision.subject.kind === 'version' && sameVersionRef(decision.subject, ref))
    .sort(byTime((decision) => decision.at));
}

export function latestDecisionOn(record: Pick<ProductionRecord, 'decisions'>, ref: VersionRef): Decision | undefined {
  const decisions = decisionsOn(record, ref);
  return decisions[decisions.length - 1];
}

/**
 * Credit and rights of the version's images as its latest decision kept them (see
 * `Decision.images`); undefined before any decision or for decisions recorded without them.
 */
export function decidedImageRights(record: Pick<ProductionRecord, 'decisions'>, version: Version): ImageRightsRecord[] | undefined {
  return latestDecisionOn(record, toVersionRef(version))?.images;
}

/** Every image a draft or a version of these productions uses (what "Liberar espaço" keeps). */
export function usedAssetIds(records: Iterable<Pick<ProductionRecord, 'pieces' | 'versions'>>): Set<AssetId> {
  const used = new Set<AssetId>();
  for (const record of records) {
    const bodies = [...record.pieces.map((piece) => piece.draft.body), ...record.versions.map((version) => version.body)];
    for (const body of bodies) if (body.type === 'article') for (const assetId of articleAssetIds(body)) used.add(assetId);
  }
  return used;
}

/** Cover of the article version a carousel was made from (layouts may draw it, see `SlideLayout.articleCover`). */
export function carouselArticleCover(record: Pick<ProductionRecord, 'versions'>, inputs: readonly VersionRef[]): ImageRef | undefined {
  for (const input of inputs) {
    const parent = findVersion(record, input.versionId);
    if (parent?.body.type === 'article' && parent.body.cover) return parent.body.cover;
  }
  return undefined;
}

/** A version is approved when the latest decision on that exact ref is `approved`. */
export function isApproved(record: Pick<ProductionRecord, 'decisions'>, ref: VersionRef): boolean {
  return latestDecisionOn(record, ref)?.decision === 'approved';
}

/** Decisions about any version of a piece, oldest first. */
export function pieceDecisions(record: Pick<ProductionRecord, 'decisions'>, pieceId: PieceId): Decision[] {
  return record.decisions
    .filter((decision) => decision.subject.kind === 'version' && decision.subject.pieceId === pieceId)
    .sort(byTime((decision) => decision.at));
}

export type ApprovedVersion = { version: Version; ref: VersionRef; decision: Decision };

/** The most recently approved version of a piece (approval time, then version number). */
export function latestApproved(record: Pick<ProductionRecord, 'versions' | 'decisions'>, pieceId: PieceId): ApprovedVersion | undefined {
  let best: ApprovedVersion | undefined;
  for (const version of versionsOf(record, pieceId)) {
    const ref = toVersionRef(version);
    const decision = latestDecisionOn(record, ref);
    if (decision?.decision !== 'approved') continue;
    if (
      !best ||
      Date.parse(decision.at) > Date.parse(best.decision.at) ||
      (decision.at === best.decision.at && version.number > best.version.number)
    ) {
      best = { version, ref, decision };
    }
  }
  return best;
}

/** Latest review request of the piece that has no decision on that exact version after it. */
export function pendingReview(record: Pick<ProductionRecord, 'reviewRequests' | 'decisions'>, pieceId: PieceId): ReviewRequest | undefined {
  const requests = record.reviewRequests
    .filter((request) => request.subject.pieceId === pieceId)
    .sort(byTime((request) => request.requestedAt));
  const latest = requests[requests.length - 1];
  if (!latest) return undefined;
  const decidedAfter = decisionsOn(record, latest.subject).some(
    (decision) => Date.parse(decision.at) >= Date.parse(latest.requestedAt),
  );
  return decidedAfter ? undefined : latest;
}

export function runsOf(record: Pick<ProductionRecord, 'runs'>, pieceId?: PieceId): GenerationRun[] {
  return record.runs
    .filter((run) => pieceId === undefined || run.pieceId === pieceId)
    .sort(byTime((run) => run.createdAt));
}

/**
 * Runs a person started, without the per-section child runs a generation opens inside itself
 * (a child is only ever active while its parent is, and a failing child fails its parent).
 */
export function topLevelRuns(record: Pick<ProductionRecord, 'runs'>, pieceId?: PieceId): GenerationRun[] {
  return runsOf(record, pieceId).filter((run) => !run.parentRunId);
}

export function activeRun(record: Pick<ProductionRecord, 'runs'>, pieceId?: PieceId): GenerationRun | undefined {
  return topLevelRuns(record, pieceId).filter(isRunActive).pop();
}

export function lastRun(record: Pick<ProductionRecord, 'runs'>, pieceId?: PieceId): GenerationRun | undefined {
  return topLevelRuns(record, pieceId).pop();
}

export function pendingSuggestions(record: Pick<ProductionRecord, 'suggestions'>, pieceId: PieceId): Suggestion[] {
  return record.suggestions.filter((suggestion) => suggestion.pieceId === pieceId && isSuggestionPending(suggestion));
}

export function currentSourceRefs(record: Pick<ProductionRecord, 'sources'>): SourceVersionRef[] {
  return record.sources.map((source) => toSourceVersionRef(source, currentSourceVersion(source)));
}

export function latestDelivery(record: Pick<ProductionRecord, 'deliveries'>): Delivery | undefined {
  return [...record.deliveries].sort(byTime((delivery) => delivery.createdAt)).pop();
}

/** Last instant anything happened in the record (for "Atualizada há 2 h" and sorting). */
export function lastActivityAt(record: ProductionRecord): string {
  const instants = [
    record.production.updatedAt,
    ...record.pieces.map((piece) => piece.draft.updatedAt),
    ...record.versions.map((version) => version.createdAt),
    ...record.decisions.map((decision) => decision.at),
    ...record.reviewRequests.map((request) => request.requestedAt),
    ...record.runs.map((run) => run.endedAt ?? run.startedAt ?? run.createdAt),
    ...record.deliveries.map((delivery) => delivery.createdAt),
  ];
  return instants.reduce((latest, instant) => (Date.parse(instant) > Date.parse(latest) ? instant : latest));
}
