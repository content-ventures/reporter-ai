import 'server-only';
import type { PoolClient } from 'pg';
import type { EditorialChanges } from '../ports/editorial-rows.ts';
import { toVersionRef, type Piece, type Version } from '../domain/piece.ts';
import type { Decision } from '../domain/decision.ts';
import type { Source } from '../domain/source.ts';
import { articleHash } from '../domain/article.ts';
import { memoryWritingOccurrences } from '../domain/editorial-memory-writing.ts';
import { FlowError } from './errors.ts';

/** Actual draft and approved-version uses share the transaction that saved their documents. */
export async function syncMemoryWriting(client: PoolClient, changes: EditorialChanges): Promise<void> {
  const pieces = changes.parts.filter(part => part.kind === 'piece' && !part.deleted && (part.doc as Piece)?.kind === 'article');
  const sources = new Map<string, Source[]>();
  const originalsFor = async (productionId: string) => {
    let originals = sources.get(productionId);
    if (!originals) {
      originals = (await client.query('SELECT public.reporter_memory_writing_sources($1) AS value', [productionId])).rows[0].value as Source[];
      sources.set(productionId, originals);
    }
    return originals;
  };
  for (const part of pieces) {
    const originals = await originalsFor(part.productionId);
    const piece = part.doc as Piece, body = piece.draft.body;
    if (body.type !== 'article') continue;
    for (const source of originals) for (const occurrence of memoryWritingOccurrences(body, source)) {
      await client.query('SELECT public.reporter_memory_record_insertion($1::jsonb)', [JSON.stringify({ productionId: part.productionId, pieceId: piece.id,
        draftRevision: piece.draft.revision, articleHash: articleHash(body), blockId: occurrence.blockId, from: occurrence.from, to: occurrence.to,
        source: { id: source.id, version: occurrence.sourceVersion, segmentId: occurrence.binding.segmentId, from: occurrence.sourceFrom, to: occurrence.sourceTo } })]);
    }
  }
  for (const part of changes.parts.filter(part => part.kind === 'decision' && !part.deleted)) {
    const decision = part.doc as Decision;
    if (decision.decision !== 'approved' || decision.gate !== 'article.approval' || decision.subject.kind !== 'version') continue;
    const originals = await originalsFor(part.productionId);
    if (!originals.length) continue;
    const version = (await client.query("SELECT public.reporter_memory_approved_version($1,$2) AS value", [part.productionId, decision.subject.versionId])).rows[0].value as Version | null;
    if (!version || version.body.type !== 'article') throw new FlowError('MEMORY_CONFLICT', 409);
    for (const source of originals) for (const occurrence of memoryWritingOccurrences(version.body, source)) {
      await client.query('SELECT public.reporter_memory_record_approval($1::jsonb)', [JSON.stringify({ productionId: part.productionId,
        decisionId: decision.id, article: toVersionRef(version), blockId: occurrence.blockId, from: occurrence.from, to: occurrence.to,
        source: { id: source.id, version: occurrence.sourceVersion, segmentId: occurrence.binding.segmentId, from: occurrence.sourceFrom, to: occurrence.sourceTo } })]);
    }
  }
}
