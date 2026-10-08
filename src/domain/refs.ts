import type {
  AssetId,
  BlockId,
  IsoDateTime,
  PieceId,
  ProductionId,
  QuoteId,
  SegmentId,
  SourceId,
  VersionId,
} from './ids.ts';

/**
 * References are the glue of provenance (REQ-1.6, REQ-T.2, REQ-T.7). Each carries a `kind`
 * discriminant so mixed lists (run inputs, decision subjects) stay type-safe.
 */

/** Points at one exact, immutable piece version. Equality is id + content hash. */
export type VersionRef = {
  kind: 'version';
  pieceId: PieceId;
  versionId: VersionId;
  number: number;
  hash: string;
};

/** Character range inside one transcript segment (offsets in the segment text). */
export type SegmentLocator = { type: 'segment'; segmentId: SegmentId; from?: number; to?: number };
/** Web evidence (R2 REQ-2.6): URL + the excerpt actually used + when it was retrieved. */
export type UrlLocator = { type: 'url'; url: string; excerpt: string; retrievedAt: IsoDateTime };
/** A catalogued quote (R2 F2.11). */
export type QuoteLocator = { type: 'quote'; quoteId: QuoteId };
/** A time range inside audio/video (R4). */
export type MediaLocator = { type: 'media'; startMs: number; endMs: number };

export type SourceLocator = SegmentLocator | UrlLocator | QuoteLocator | MediaLocator;

/** Evidence pointer: a location inside one specific version of a source. */
export type SourceRef = {
  kind: 'source';
  sourceId: SourceId;
  sourceVersion: number;
  locator: SourceLocator;
};

/** A whole source version used as input (run context, version provenance). */
export type SourceVersionRef = {
  kind: 'source-version';
  sourceId: SourceId;
  sourceVersion: number;
  hash: string;
};

/** Reserved for R2 images, R5 avatar/voice assets, R6 channel assets. */
export type AssetRef = { kind: 'asset'; assetId: AssetId; assetVersion?: number; hash?: string };

/** Snapshot of a production brief (pauta) at a given revision. */
export type BriefRef = { kind: 'brief'; productionId: ProductionId; revision: number; hash: string };

export type Ref = VersionRef | SourceRef | SourceVersionRef | AssetRef | BriefRef;

/** What a gate decision can be about (REQ-T.6 generalised: versions, evidence, assets, briefs). */
export type DecisionSubject = VersionRef | SourceRef | AssetRef | BriefRef;

/** Range inside an article block's plain text (see `blockText`). Offsets are UTF-16 indexes. */
export type TextRange = { blockId: BlockId; from: number; to: number };

export function sameVersionRef(a: VersionRef, b: VersionRef): boolean {
  return a.pieceId === b.pieceId && a.versionId === b.versionId && a.hash === b.hash;
}

function locatorKey(locator: SourceLocator): string {
  switch (locator.type) {
    case 'segment':
      return `segment:${locator.segmentId}:${locator.from ?? ''}:${locator.to ?? ''}`;
    case 'url':
      return `url:${locator.url}:${locator.excerpt}`;
    case 'quote':
      return `quote:${locator.quoteId}`;
    case 'media':
      return `media:${locator.startMs}:${locator.endMs}`;
  }
}

/** Stable string key for any reference (map keys, React keys, dedupe). */
export function refKey(ref: Ref): string {
  switch (ref.kind) {
    case 'version':
      return `version:${ref.pieceId}:${ref.versionId}:${ref.hash}`;
    case 'source':
      return `source:${ref.sourceId}@${ref.sourceVersion}:${locatorKey(ref.locator)}`;
    case 'source-version':
      return `source-version:${ref.sourceId}@${ref.sourceVersion}:${ref.hash}`;
    case 'asset':
      return `asset:${ref.assetId}@${ref.assetVersion ?? ''}:${ref.hash ?? ''}`;
    case 'brief':
      return `brief:${ref.productionId}@${ref.revision}:${ref.hash}`;
  }
}

export function sameRef(a: Ref, b: Ref): boolean {
  return refKey(a) === refKey(b);
}

/** Order-insensitive equality of two reference lists. */
export function sameRefSet(a: readonly Ref[], b: readonly Ref[]): boolean {
  if (a.length !== b.length) return false;
  const keys = new Set(a.map(refKey));
  return b.every((ref) => keys.has(refKey(ref)));
}

export function segmentRef(
  sourceId: SourceId,
  sourceVersion: number,
  segmentId: SegmentId,
  range?: { from: number; to: number },
): SourceRef {
  const locator: SegmentLocator = range
    ? { type: 'segment', segmentId, from: range.from, to: range.to }
    : { type: 'segment', segmentId };
  return { kind: 'source', sourceId, sourceVersion, locator };
}

export function dedupeRefs<R extends Ref>(refs: readonly R[]): R[] {
  const seen = new Set<string>();
  const out: R[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}
