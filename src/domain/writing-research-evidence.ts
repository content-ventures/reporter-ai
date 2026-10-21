import type { Source, TranscriptContent } from './source.ts';
import { sourceContentHash } from './source.ts';
import type { SourceRef } from './refs.ts';
import type { WritingExternalSource } from './writing-research.ts';
import { contentHash } from './text/hash.ts';

/** Persist the exact returned excerpt, never a fetched page or reconstructed interview. */
export function writingResearchEvidence(results: readonly WritingExternalSource[], context: { runId: string; workspaceId: string; actorId: string }) {
  const references = new Map<string, SourceRef>();
  const sources: Source[] = results.map(result => {
    const id = 'research-' + contentHash({ runId: context.runId, id: result.id, url: result.url, excerpt: result.excerpt });
    const content: TranscriptContent = { type: 'transcript', format: 'plain', segments: [{ id: id + '-excerpt', text: result.excerpt }] };
    references.set(result.id, { kind: 'source', sourceId: id, sourceVersion: 1,
      locator: { type: 'url', url: result.url, excerpt: result.excerpt, retrievedAt: result.retrievedAt } });
    return { id, workspaceId: context.workspaceId, kind: 'news', title: 'Pesquisa web · ' + result.title,
      origin: 'other', sourceUrl: result.url, speakers: [],
      research: { provider: 'tavily', runId: context.runId, query: result.query, retrievedAt: result.retrievedAt, publishedOn: result.publishedOn },
      rights: { authorized: true, note: 'Contexto externo consultado pela pesquisa habilitada para esta execução. A coleta não confirma a afirmação nem autoriza reproduzir a página integral.' },
      versions: [{ number: 1, hash: sourceContentHash(content), content, createdAt: result.retrievedAt, createdBy: context.actorId }],
      createdAt: result.retrievedAt, createdBy: context.actorId };
  });
  return { sources, references };
}
