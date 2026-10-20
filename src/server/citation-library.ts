import 'server-only';
import { z } from 'zod';
import { citationDay, citationId, citationsFromArticle, citationUses, citationView, locateCitation, podcastLink } from '../domain/citation-library.ts';
import type { Citation, CitationLibraryView, CitationUse } from '../domain/citation-library.ts';
import type { EditorialCheckpoint } from '../ports/connected-workspace.ts';
import { canOpenProduction } from '../domain/production.ts';
import { can } from '../domain/permissions.ts';
import { editorialTransaction } from './editorial';
import type { EditorialScope } from './editorial-store';
import { FlowError, forbiddenError } from './errors';

/** Read projection over existing articles + curated entries; GET never mutates the workspace. */
export function citationRegistry(checkpoint: EditorialCheckpoint): CitationLibraryView {
  const { state } = checkpoint;
  const member = state.members.find(member => member.personId === state.sessionPersonId);
  const records = state.productions.filter(record => canOpenProduction(record.production,member));
  const accessibleSources = new Set(records.flatMap(record => record.production.sourceIds));
  const accessibleProductions = new Set(records.map(record => record.production.id));
  const citations = new Map<string, Citation>(), appearances: (CitationUse & { citationId: string })[] = [];
  for (const record of records) {
    const bodies = [...record.pieces.map(piece => ({ body: piece.draft.body,at: piece.draft.updatedAt })),
      ...record.versions.map(version => ({ body: version.body,at: version.createdAt }))];
    for (const entry of bodies) {
      if (entry.body.type !== 'article') continue;
      for (const citation of citationsFromArticle(entry.body,state.sources.filter(source => record.production.sourceIds.includes(source.id)),
        record.production.id,entry.at)) {
        if (!citations.has(citation.id)) citations.set(citation.id,citation);
        appearances.push({ citationId: citation.id,productionId: record.production.id,title: record.production.title,at: entry.at });
      }
    }
  }
  const uses = citationUses(appearances);
  for (const citation of checkpoint.citations ?? []) if (accessibleSources.has(citation.ref.sourceId) && accessibleProductions.has(citation.productionId)) citations.set(citation.id,citation);
  return { items: [...citations.values()].flatMap(citation => {
    const source = state.sources.find(source => source.id === citation.ref.sourceId);
    return source ? [citationView(citation,source,state.people,{ uses: uses.get(citation.id) ?? [] })] : [];
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt)), sources: state.sources.filter(source => source.rights.authorized && accessibleSources.has(source.id)).map(source => ({
    id: source.id,version: source.versions.at(-1)!.number,title: source.programName || source.title,
    productionId: records.find(record => record.production.sourceIds.includes(source.id))!.production.id,
  })) };
}
const optionalText = (max: number) => z.string().trim().max(max).optional();
const schema = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/).optional(), baseRevision: z.number().int().nonnegative(),
  input: z.object({ sourceId: z.string().min(1).max(128),sourceVersion: z.number().int().positive(),productionId: z.string().min(1).max(128),
    text: z.string().trim().min(24).max(1200),personId: z.string().min(1).max(128).optional(),authorConfirmed: z.boolean(),
    relevance: z.string().trim().max(600),podcastName: optionalText(160),podcastUrl: optionalText(2000),recordedOn: optionalText(10),location: optionalText(160),
  }).strict() }).strict();
// Citations come from article drafts and versions plus curated entries; runs are never read.
const CITATION_SCOPE: EditorialScope = { productions: 'all',parts: ['piece','version'],runs: 'none',pipelines: false,items: { citation: 'all' } };
export async function handleCitationLibrary(request: Request, path: string[], readJson: (request: Request) => Promise<unknown>) {
  if (path.length) throw new FlowError('NOT_FOUND',404);
  if (request.method === 'GET') return Response.json((await editorialTransaction('runtime',async checkpoint => citationRegistry(checkpoint),false,'reporter.edit',CITATION_SCOPE)).value,{ headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') throw new FlowError('NOT_FOUND',404);
  const payload = schema.parse(await readJson(request));
  const value = (await editorialTransaction('runtime',async checkpoint => {
    const view = citationRegistry(checkpoint), input = payload.input;
    const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
    if (!can(member,'library.edit')) throw forbiddenError('library.edit');
    const record = checkpoint.state.productions.find(record => record.production.id === input.productionId);
    const source = checkpoint.state.sources.find(source => source.id === input.sourceId);
    if (!record || !source || !source.rights.authorized || !canOpenProduction(record.production,member)
      || !record.production.sourceIds.includes(source.id)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
    const editing = payload.id ? view.items.find(item => item.id === payload.id) : undefined;
    if (payload.id && !editing) throw new FlowError('NOT_FOUND',404);
    const located = locateCitation(source,input.sourceVersion,input.text,editing?.ref.locator.type === 'segment' ? editing.ref.locator.segmentId : undefined);
    if (!located) throw new FlowError('CITATION_NOT_LITERAL',422);
    if (!citationDay(input.recordedOn) || input.podcastUrl && !podcastLink(input.podcastUrl)) throw new FlowError('CITATION_METADATA_INVALID',422);
    if (input.personId && !source.speakers.some(speaker => speaker.personId === input.personId)
      || input.authorConfirmed && !input.personId) throw new FlowError('CITATION_AUTHOR_INVALID',422);
    const id = citationId(located.ref,located.text), previous = view.items.find(item => item.id === id);
    if (payload.id && payload.id !== id) throw new FlowError('CITATION_IMMUTABLE',422);
    const now = new Date().toISOString();
    const next: Citation = { id,revision: (previous?.revision ?? 0)+1,text: located.text,ref: located.ref,sourceHash: located.hash,
      productionId: input.productionId,createdAt: previous?.createdAt ?? now,updatedAt: now,authorConfirmed: input.authorConfirmed,
      relevance: input.relevance,...(input.personId ? { personId: input.personId } : {}),
      ...(input.podcastName ? { podcastName: input.podcastName } : {}),...(input.podcastUrl ? { podcastUrl: podcastLink(input.podcastUrl) } : {}),
      ...(input.recordedOn ? { recordedOn: input.recordedOn } : {}),...(input.location ? { location: input.location } : {}) };
    // Exact retry after ambiguous response is idempotent; concurrent different edits are not.
    const same = previous && ['personId','authorConfirmed','relevance','podcastName','podcastUrl','recordedOn','location'].every(key =>
      previous[key as keyof Citation] === next[key as keyof Citation]);
    if (previous?.revision === payload.baseRevision+1 && same) return previous;
    if ((previous?.revision ?? 0) !== payload.baseRevision) throw new FlowError('CITATION_CONFLICT',409);
    const saved = checkpoint.citations ??= [];
    if (!saved.some(item => item.id === id) && saved.length >= 5000) throw new FlowError('LIBRARY_FULL',422);
    checkpoint.citations = [...saved.filter(item => item.id !== id),next];
    return citationView(next,source,checkpoint.state.people,{ uses: previous?.uses ?? [] });
  },true,'reporter.edit',CITATION_SCOPE)).value;
  return Response.json(value,{ headers: { 'Cache-Control': 'no-store' } });
}
