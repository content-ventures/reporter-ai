import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { refreshMemoryWriting } from '../domain/editorial-memory-refresh.ts';
import { initialMemoryPolicy, type MemorySelection } from '../domain/editorial-memory.ts';
import type { MemoryWritingItem } from '../domain/editorial-memory-writing.ts';
import { can } from '../domain/permissions.ts';
import { outputSourceRefs, pendingReview } from '../domain/record.ts';
import { ok } from '../domain/result.ts';
import { updateDraft } from '../domain/rules/versions.ts';
import { isRunActive } from '../domain/run.ts';
import { toSourceVersionRef } from '../domain/source.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { MemorySourceRefreshInput, MemorySourceRefreshResult } from '../ports/editorial-memory.ts';
import { editorialTransaction } from './editorial.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryIdSchema, memorySourceRefreshSchema } from './editorial-memory-input.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryError } from './editorial-memory-store.ts';
import { FlowError, forbiddenError } from './errors.ts';
import { currentReporterContext } from './request-context.ts';

/** Explicit, atomic replacement of future input; no original or historical article is rewritten. */
export async function refreshEditorialMemorySource(id: string, value: MemorySourceRefreshInput, requestId: string): Promise<MemorySourceRefreshResult> {
  memoryIdSchema.parse(id); const input = memorySourceRefreshSchema.parse(value), context = currentReporterContext();
  if (id !== input.expected.sourceId) throw new FlowError('INVALID_INPUT', 422);
  if (context.view || !can(context.roles, 'library.edit')) throw forbiddenError('library.edit');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new FlowError('IDEMPOTENCY_KEY_REQUIRED', 422);
  const operation = 'memory.source.refresh', hash = createHash('sha256').update(stableStringify({ id, input })).digest('hex');
  try {
    return (await editorialTransaction<MemorySourceRefreshResult>('runtime', async (_checkpoint, engine, client) => {
      const member = engine.store.state.members.find(member => member.personId === context.actor);
      for (const capability of ['library.edit', 'production.edit', 'piece.edit'] as const) if (!can(member, capability)) throw forbiddenError(capability);
      await client.query("SELECT public.reporter_memory_authorize('library.edit')");
      if (!(await engine.queries.get(input.target.productionId)).ok) throw new FlowError('NOT_FOUND', 404);
      const record = engine.records.record(input.target.productionId), source = record?.sources.find(source => source.id === id && source.memory);
      const piece = record?.pieces.find(piece => piece.kind === 'article');
      if (!record || !source || piece?.draft.body.type !== 'article') throw new FlowError('NOT_FOUND', 404);
      const replay = (await client.query('SELECT public.reporter_memory_receipt($1,$2,$3) AS value', [operation, requestId, hash])).rows[0].value;
      if (replay.replayed) return replay.result as MemorySourceRefreshResult;
      if (record.production.archivedAt || record.production.updatedAt !== input.target.updatedAt || piece.draft.revision !== input.target.draftRevision
        || pendingReview(record, piece.id) || record.runs.some(isRunActive)) {
        const error = new FlowError('MEMORY_CONFLICT', 409); error.reason = 'A pauta mudou, está em geração ou aguarda aprovação. Atualize antes de trocar a fonte.'; throw error;
      }
      let replacement: { selection: MemorySelection; items: MemoryWritingItem[] } | null = null;
      if (input.selection) {
        const scope = (await client.query('SELECT public.reporter_memory_selection_scope($1) AS value', [input.selection.id])).rows[0].value as { selection: MemorySelection; restrictedTo: string[] | null } | null;
        if (!scope) throw new FlowError('NOT_FOUND', 404);
        if (scope.selection.revision !== input.selection.revision || scope.selection.productionId !== record.production.id) throw new FlowError('MEMORY_CONFLICT', 409);
        if (scope.restrictedTo !== null && (!record.production.restrictedTo
          || [record.production.ownerId, ...record.production.restrictedTo].some(person => !scope.restrictedTo!.includes(person)))) throw new FlowError('MEMORY_CONFLICT', 409);
        const state = await memoryReadState(client), items: MemoryWritingItem[] = [];
        for (const selected of scope.selection.items) {
          const bundle = await memoryBundle(client, selected.evidence.id, state), evidence = bundle.evidence;
          items.push({ view: memoryView(bundle), policy: bundle.policy ?? initialMemoryPolicy(context.portal),
            ...(evidence.kind === 'citation' ? { author: engine.store.state.people.find(person => person.id === evidence.personId) } : {}) });
        }
        replacement = { selection: scope.selection, items };
      }
      const refreshed = refreshMemoryWriting(source, input.expected, replacement, piece.draft.body, input.updateDraftReferences, input.reason,
        { actorId: context.actor, now: new Date().toISOString(), newId: prefix => `${prefix}-${randomUUID()}` });
      if (!refreshed.ok) { const error = new FlowError('MEMORY_CONFLICT', 409); error.reason = refreshed.refusal.message; throw error; }
      const next = refreshed.value, ref = toSourceVersionRef(next.source);
      const installed = engine.store.transact((state, ctx) => {
        let updated = piece;
        if (next.updatedReferences) {
          const draft = updateDraft(piece, next.body, input.target.draftRevision, ctx);
          if (!draft.ok) return draft;
          updated = { ...draft.value, draft: { ...draft.value.draft, sources: outputSourceRefs({ sources: record.sources.map(source => source.id === id ? next.source : source) },
            next.body, piece.draft.sources.map(source => source.sourceId === id ? ref : source)) } };
        }
        const result: MemorySourceRefreshResult = { productionId: record.production.id, pieceId: piece.id, source: ref, selection: input.selection,
          draftRevision: updated.draft.revision, updatedReferences: next.updatedReferences, concerns: next.concerns, retired: next.retired };
        return ok({ value: result, productionIds: [record.production.id],
          state: { ...state, sources: state.sources.map(source => source.id === id ? next.source : source),
            productions: state.productions.map(entry => entry.production.id !== record.production.id ? entry : { ...entry,
              production: { ...entry.production, updatedAt: ctx.now }, pieces: entry.pieces.map(item => item.id === piece.id ? updated : item) }) },
          activity: [{ type: 'source.revised' as const, productionId: record.production.id, subject: ref, data: { reason: input.reason, number: ref.sourceVersion, retired: next.retired, updatedReferences: next.updatedReferences } }] });
      });
      if (!installed.ok) throw new FlowError('MEMORY_CONFLICT', 409);
      await client.query('SELECT public.reporter_memory_receipt($1,$2,$3,$4::jsonb)', [operation, requestId, hash, JSON.stringify(installed.value)]);
      return installed.value;
    }, true, 'reporter.edit', { productions: [input.target.productionId], pipelines: false, jobs: false, items: { person: 'all', member: 'all', activity: 'production' } })).value;
  } catch (error) { return memoryError(error); }
}
