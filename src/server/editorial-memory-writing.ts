import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { prepareMemoryWriting, type MemoryWritingItem } from '../domain/editorial-memory-writing.ts';
import { initialMemoryPolicy, type MemorySelection } from '../domain/editorial-memory.ts';
import { can } from '../domain/permissions.ts';
import { ok } from '../domain/result.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { MemoryWritingInput, MemoryWritingResult } from '../ports/editorial-memory.ts';
import { editorialTransaction } from './editorial.ts';
import { memoryBundle, memoryReadState } from './editorial-memory-detail.ts';
import { memoryView } from './editorial-memory-query.ts';
import { memoryError } from './editorial-memory-store.ts';
import { memoryIdSchema, memoryWritingInputSchema } from './editorial-memory-input.ts';
import { currentReporterContext } from './request-context.ts';
import { FlowError, forbiddenError } from './errors.ts';

export async function writeMemorySelection(id: string, value: MemoryWritingInput, requestId: string): Promise<MemoryWritingResult> {
  memoryIdSchema.parse(id); const input = memoryWritingInputSchema.parse(value), context = currentReporterContext();
  if (context.view || !can(context.roles, 'library.edit')) throw forbiddenError('library.edit');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new FlowError('IDEMPOTENCY_KEY_REQUIRED', 422);
  const operation = 'memory.selection.write', hash = createHash('sha256').update(stableStringify({ id, input })).digest('hex');
  try {
    return (await editorialTransaction('runtime', async (_checkpoint, engine, client) => {
      const member = engine.store.state.members.find(member => member.personId === context.actor);
      if (!can(member, 'library.edit') || !can(member, 'production.create')) throw forbiddenError('production.create');
      await client.query("SELECT public.reporter_memory_authorize('library.edit')");
      const scope = (await client.query('SELECT public.reporter_memory_selection_scope($1) AS value', [id])).rows[0].value as { selection: MemorySelection; restrictedTo: string[] | null } | null;
      if (!scope) throw new FlowError('NOT_FOUND', 404);
      const receipt = (await client.query('SELECT public.reporter_memory_receipt($1,$2,$3) AS value', [operation, requestId, hash])).rows[0].value;
      if (receipt.replayed) {
        await client.query('SELECT public.reporter_memory_selection_target($1)', [receipt.result.productionId]); return receipt.result as MemoryWritingResult;
      }
      if (scope.selection.revision !== input.baseRevision) throw new FlowError('MEMORY_CONFLICT', 409);
      const state = await memoryReadState(client), items: MemoryWritingItem[] = [];
      for (const selected of scope.selection.items) {
        const bundle = await memoryBundle(client, selected.evidence.id, state), evidence = bundle.evidence;
        items.push({ view: memoryView(bundle), policy: bundle.policy ?? initialMemoryPolicy(context.portal),
          ...(evidence.kind === 'citation' ? { author: engine.store.state.people.find(person => person.id === evidence.personId) } : {}) });
      }
      const prepared = prepareMemoryWriting(scope.selection, items, input.title, { actorId: context.actor, now: new Date().toISOString(), newId: prefix => `${prefix}-${randomUUID()}` });
      if (!prepared.ok) { const error = new FlowError('MEMORY_NOT_READY', 409); error.reason = prepared.refusal.message; throw error; }
      const created = await engine.commands.createBlank({ title: input.title, brief: input.brief });
      if (!created.ok) { const error = new FlowError('INVALID_INPUT', 422); error.reason = created.refusal.message; throw error; }
      const { source, body } = prepared.value, result = { ...created.value, sourceId: source.id };
      const installed = engine.store.transact((current, ctx) => ok({ value: result, productionIds: [result.productionId],
        state: { ...current, sources: [...current.sources, source], productions: current.productions.map(entry => entry.production.id !== result.productionId ? entry : {
          ...entry, production: { ...entry.production, sourceIds: [source.id], ...(scope.restrictedTo === null ? {} : { restrictedTo: scope.restrictedTo }), updatedAt: ctx.now },
          pieces: entry.pieces.map(piece => piece.id !== result.pieceId ? piece : { ...piece, draft: { ...piece.draft, body, revision: 1,
            sources: [{ kind: 'source-version' as const, sourceId: source.id, sourceVersion: 1, hash: source.versions[0].hash }], updatedAt: ctx.now, updatedBy: ctx.actorId } }),
        }) } }));
      if (!installed.ok) throw new FlowError('MEMORY_CONFLICT', 409);
      await client.query('SELECT public.reporter_memory_receipt($1,$2,$3,$4::jsonb)', [operation, requestId, hash, JSON.stringify(result)]);
      return result;
    }, true, 'reporter.edit', { productions: [], sources: 'none', parts: ['piece'], runs: 'none', jobs: false, pipelines: false,
      items: { person: 'all', member: 'all', activity: 'production' } })).value;
  } catch (failure) { return memoryError(failure); }
}

