import 'server-only';
import type { PoolClient } from 'pg';
import type { EditorialChanges } from '../ports/editorial-rows.ts';
import type { Piece } from '../domain/piece.ts';
import type { Source } from '../domain/source.ts';
import { articleHash } from '../domain/article.ts';
import { memoryWritingOccurrences } from '../domain/editorial-memory-writing.ts';

/** Uses are derived after the draft commits, within that same transaction. */
export async function syncMemoryWriting(client: PoolClient, changes: EditorialChanges): Promise<void> {
  const pieces = changes.parts.filter(part => part.kind === 'piece' && !part.deleted && (part.doc as Piece)?.kind === 'article');
  const sources = new Map<string, Source[]>();
  for (const part of pieces) {
    let originals = sources.get(part.productionId);
    if (!originals) {
      originals = (await client.query('SELECT public.reporter_memory_writing_sources($1) AS value', [part.productionId])).rows[0].value;
      sources.set(part.productionId, originals!);
    }
    const piece = part.doc as Piece, body = piece.draft.body;
    if (body.type !== 'article') continue;
    for (const source of originals!) for (const occurrence of memoryWritingOccurrences(body, source)) {
      await client.query('SELECT public.reporter_memory_record_insertion($1::jsonb)', [JSON.stringify({ productionId: part.productionId, pieceId: piece.id,
        draftRevision: piece.draft.revision, articleHash: articleHash(body), blockId: occurrence.blockId, from: occurrence.from, to: occurrence.to,
        source: { id: source.id, version: occurrence.sourceVersion, segmentId: occurrence.binding.segmentId, from: occurrence.sourceFrom, to: occurrence.sourceTo } })]);
    }
  }
}
