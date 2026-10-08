import type { PieceId, SourceId } from '../ids.ts';
import type { Version } from '../piece.ts';
import { latestApproved, latestVersion } from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import type { SourceVersionRef, VersionRef } from '../refs.ts';
import { currentSourceVersion, toSourceVersionRef } from '../source.ts';

/**
 * Staleness ("Desatualizado"): a derivative built from an approved parent version becomes
 * stale when the parent gets a NEWER approved version; content built from a source version
 * becomes stale when the source is corrected (R4). Stale content is never deleted.
 */

export type StaleInput = { input: VersionRef; latest?: VersionRef };
export type StaleSource = { input: SourceVersionRef; latest: SourceVersionRef };

export type Freshness = {
  state: 'fresh' | 'stale';
  staleInputs: StaleInput[];
  staleSources: StaleSource[];
};

export type FreshnessLookup = {
  latestApproved: (pieceId: PieceId) => VersionRef | undefined;
  currentSource: (sourceId: SourceId) => SourceVersionRef | undefined;
};

export function versionFreshness(content: Pick<Version, 'inputs' | 'sources'>, lookup: FreshnessLookup): Freshness {
  const staleInputs: StaleInput[] = [];
  for (const input of content.inputs) {
    const latest = lookup.latestApproved(input.pieceId);
    if (!latest || latest.versionId !== input.versionId || latest.hash !== input.hash) {
      staleInputs.push(latest ? { input, latest } : { input });
    }
  }
  const staleSources: StaleSource[] = [];
  for (const input of content.sources) {
    const latest = lookup.currentSource(input.sourceId);
    if (latest && latest.sourceVersion !== input.sourceVersion) staleSources.push({ input, latest });
  }
  return {
    state: staleInputs.length > 0 || staleSources.length > 0 ? 'stale' : 'fresh',
    staleInputs,
    staleSources,
  };
}

export function freshnessLookup(record: Pick<ProductionRecord, 'versions' | 'decisions' | 'sources'>): FreshnessLookup {
  return {
    latestApproved: (pieceId) => latestApproved(record, pieceId)?.ref,
    currentSource: (sourceId) => {
      const source = record.sources.find((candidate) => candidate.id === sourceId);
      return source ? toSourceVersionRef(source, currentSourceVersion(source)) : undefined;
    },
  };
}

/** Freshness of a piece: its latest approved version, else its latest version, else its draft. */
export function pieceFreshness(record: ProductionRecord, pieceId: PieceId): Freshness {
  const piece = record.pieces.find((candidate) => candidate.id === pieceId);
  const content = latestApproved(record, pieceId)?.version ?? latestVersion(record, pieceId) ?? piece?.draft;
  if (!content) return { state: 'fresh', staleInputs: [], staleSources: [] };
  return versionFreshness(content, freshnessLookup(record));
}

/** pt-BR explanation for the amber Alert ("O artigo aprovado mudou para a versão 5"). */
export function freshnessMessage(freshness: Freshness, parentLabel = 'artigo'): string | undefined {
  const input = freshness.staleInputs[0];
  if (input) {
    return input.latest
      ? `O ${parentLabel} aprovado mudou para a versão ${input.latest.number}.`
      : `A versão ${input.input.number} do ${parentLabel} não está mais aprovada.`;
  }
  const source = freshness.staleSources[0];
  if (source) return `O material foi corrigido (versão ${source.latest.sourceVersion}).`;
  return undefined;
}
