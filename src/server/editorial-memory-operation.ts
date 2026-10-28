import 'server-only';
import type { PoolClient } from 'pg';
import type { ArticleBody } from '../domain/article.ts';
import { validateMemoryArticle, validateMemoryWritingSources } from '../domain/editorial-memory-guard.ts';
import { initialMemoryPolicy } from '../domain/editorial-memory.ts';
import type { MemoryWritingItem } from '../domain/editorial-memory-writing.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { SourceVersionRef } from '../domain/refs.ts';
import type { Source } from '../domain/source.ts';
import { ok } from '../domain/result.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryView } from './editorial-memory-query.ts';
import { FlowError } from './errors.ts';

/** Uses the editorial transaction's lock and context; no nested transaction or cursor read. */
async function currentItems(client: PoolClient, sources: Source[], versions: { sourceId: string; sourceVersion: number }[]): Promise<MemoryWritingItem[]> {
  await client.query("SELECT public.reporter_memory_authorize('library.review')");
  const state = await memoryReadState(client), ids = new Set<string>(), items: MemoryWritingItem[] = [];
  for (const source of sources) for (const receipt of source.memory ?? []) {
    if (!versions.some(version => version.sourceId === source.id && version.sourceVersion === receipt.version.number)) continue;
    for (const binding of receipt.items) ids.add(binding.selected.evidence.id);
  }
  for (const id of ids) {
    try {
      const bundle = await memoryBundle(client, id, state);
      items.push({ view: memoryView(bundle), policy: bundle.policy ?? initialMemoryPolicy(bundle.evidence.workspaceId) });
    } catch (error) {
      // Losing current access blocks the operation without exposing a private origin.
      if (!(error instanceof FlowError) || !['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error;
    }
  }
  return items;
}
export async function guardMemorySources(client: PoolClient, record: ProductionRecord, refs?: SourceVersionRef[]) {
  const sources = record.sources.filter(source => source.memory);
  if (!sources.length) return ok(undefined);
  const versions = refs ?? sources.map(source => ({ sourceId: source.id, sourceVersion: source.versions.at(-1)!.number }));
  return validateMemoryWritingSources(sources, await currentItems(client, sources, versions), refs);
}
export async function guardMemoryArticle(client: PoolClient, body: ArticleBody, sources: Source[]) {
  const memory = sources.filter(source => source.memory && body.blocks.some(block => block.sourceRefs?.some(ref => ref.sourceId === source.id)));
  if (!memory.length) return ok([]);
  const refs = body.blocks.flatMap(block => block.sourceRefs ?? []);
  return validateMemoryArticle(body, memory, await currentItems(client, memory, refs));
}

/** Apply current bank gates to the exact body sent, approved or delivered. */
export async function guardMemoryCommand(client: PoolClient, record: ProductionRecord, method: string, args: unknown[]) {
  if (method === 'requestReview') {
    const body = record.pieces.find(piece => piece.id === args[0])?.draft.body;
    return body?.type === 'article' ? guardMemoryArticle(client, body, record.sources) : ok([]);
  }
  const command = args[0] as { decision?: string; subject?: { versionId?: string }; selection?: { versionId: string }[] };
  const ids = method === 'decide' && command.decision === 'approved' ? [command.subject?.versionId]
    : method === 'recordDelivery' ? (command.selection ?? []).map(ref => ref.versionId) : [];
  const versions = record.versions.filter(version => ids.includes(version.id));
  const parents = versions.flatMap(version => version.inputs.map(input => input.versionId));
  for (const version of record.versions.filter(version => ids.includes(version.id) || parents.includes(version.id))) {
    if (version.body.type !== 'article') continue;
    const checked = await guardMemoryArticle(client, version.body, record.sources); if (!checked.ok) return checked;
  }
  return ok([]);
}
