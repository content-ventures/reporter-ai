import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { headingBlock, paragraphBlock } from '../../../domain/article.ts';
import { foldRun, stampRunEvent } from '../../../domain/run-events.ts';
import type { RunEvent, RunEventPayload, RunFold } from '../../../domain/run-events.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import type { ChangeNotice } from '../../../ports/common.ts';
import { CONTRACT_TRANSCRIPT, newProductionInput } from '../../../ports/contracts/fixture.ts';
import { memoryStorage } from './storage.ts';
import { createTestPorts, TEST_PEOPLE } from './testing.ts';
import type { TestPorts } from './testing.ts';

const PROMPT = { key: 'article.generate', version: '1', hash: 'p1' };
const STEPS = [
  { id: 'read', label: 'Lendo material' },
  { id: 'write', label: 'Escrevendo' },
];

async function production(ports: TestPorts, authorized = true) {
  const result = await ports.commands.createFromSource(
    newProductionInput({ material: { text: CONTRACT_TRANSCRIPT, origin: 'interview', authorized } }),
  );
  assert.ok(result.ok);
  return { productionId: result.value.productionId, articleId: result.value.pieces[0].pieceId };
}

/** Builds a fold the way a generation adapter does: stamped events folded by the domain. */
function streamFold(run: GenerationRun, payloads: RunEventPayload[]): RunFold {
  const started: RunEventPayload = {
    type: 'run.started',
    kind: run.kind,
    productionId: run.productionId,
    ...(run.pieceId ? { pieceId: run.pieceId } : {}),
    prompt: run.prompt,
    model: run.model,
    inputs: run.inputs,
    steps: run.steps.map((step) => ({ id: step.id, label: step.label })),
    createdBy: run.createdBy,
  };
  const events: RunEvent[] = [started, ...payloads].map((payload, index) => stampRunEvent(payload, run.id, index + 1, run.createdAt));
  const fold = foldRun(events);
  assert.ok(fold);
  return fold;
}

const OPENING: RunEventPayload[] = [
  { type: 'step.started', stepId: 'read' },
  { type: 'step.completed', stepId: 'read' },
  { type: 'step.started', stepId: 'write' },
  { type: 'outline', title: 'O café que virou cooperativa', sections: [{ title: 'A virada' }] },
  { type: 'block.completed', block: paragraphBlock('g-1', 'Doze famílias decidiram vender juntas.', { ai: 'unreviewed' }) },
  { type: 'block.started', block: { id: 'g-2', type: 'heading', level: 2 } },
  { type: 'text.delta', blockId: 'g-2', delta: 'A virada da torref' },
];

describe('run ledger (generation write path)', () => {
  it('refuses a run on unauthorised material (REQ-T.1) and records inputs otherwise (REQ-1.2)', async () => {
    const ports = createTestPorts();
    const blocked = await production(ports, false);
    const refused = ports.runs.begin({ productionId: blocked.productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.refusal.code, 'source_not_authorized');

    const open = await production(ports);
    const begun = ports.runs.begin({ productionId: open.productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    const { run } = begun.value;
    assert.equal(run.model.label, 'Simulação local');
    assert.equal(run.cost, undefined, 'simulated runs never invent cost');
    assert.ok(run.inputs.some((ref) => ref.kind === 'source-version'));
    assert.ok(run.inputs.some((ref) => ref.kind === 'brief'));
    const again = ports.runs.begin({ productionId: open.productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.equal(again.ok, false);
    const detail = await ports.queries.get(open.productionId);
    assert.ok(detail.ok && detail.value.activeRuns.length === 1);
    assert.equal((await ports.queries.overview('7d')).metrics.generatingNow, 1);
  });

  it('freezes a dirty draft before regenerating, then settles v1 · IA from the stream', async () => {
    const ports = createTestPorts();
    const { productionId, articleId } = await production(ports);
    const draft = await ports.queries.draft(articleId);
    assert.ok(draft.ok);
    await ports.commands.saveDraft(articleId, { type: 'article', title: 'Notas', blocks: [paragraphBlock('n-1', 'Minhas notas.')] }, draft.value.revision);

    const begun = ports.runs.begin({ productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    assert.equal(begun.value.frozen?.number, 1, 'unsaved notes became a version first');
    const { run } = begun.value;

    const synced = ports.runs.sync(streamFold(run, OPENING));
    assert.ok(synced.ok);
    assert.deepEqual(ports.runs.fold(run.id)?.blocks.map((block) => block.id), ['g-1', 'g-2'], 'attach snapshot');

    const done = streamFold(run, [
      ...OPENING,
      { type: 'block.completed', block: headingBlock('g-2', 'A virada da torrefação', 2, { ai: 'unreviewed' }) },
      { type: 'step.completed', stepId: 'write' },
      { type: 'run.completed' },
    ]);
    const settled = ports.runs.sync(done);
    assert.ok(settled.ok);
    assert.equal(settled.value.run.status, 'completed');
    const [generated] = settled.value.versions;
    assert.equal(generated.number, 2);
    assert.equal(generated.origin, 'generation');
    assert.deepEqual(settled.value.run.output?.versionId, generated.id);

    const view = await ports.queries.version(generated.id);
    assert.ok(view.ok);
    assert.equal(view.value.label, 'v2 · IA');
    assert.equal(view.value.run?.model.label, 'Simulação local');
    const types = (await ports.queries.activity({ productionId })).items.map((item) => item.type);
    assert.ok(types.includes('run.completed') && types.includes('run.started'));
  });

  it('keeps text deltas quiet: snapshot stored, no notification', async () => {
    const ports = createTestPorts();
    const { productionId } = await production(ports);
    const begun = ports.runs.begin({ productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    ports.runs.sync(streamFold(begun.value.run, OPENING));
    const notices: ChangeNotice[] = [];
    ports.queries.subscribe((notice) => notices.push(notice));
    ports.runs.sync(streamFold(begun.value.run, [...OPENING, { type: 'text.delta', blockId: 'g-2', delta: 'ação' }]));
    assert.equal(notices.length, 0);
    assert.equal(ports.runs.fold(begun.value.run.id)?.blocks[1].text, 'A virada da torrefação');
    ports.runs.sync(streamFold(begun.value.run, [...OPENING, { type: 'step.progress', stepId: 'write', meta: 'seção 1 de 3' }]));
    assert.equal(notices.length, 1, 'a step change is visible');
  });

  it('keeps the partial as "interrompida" on cancel and keeps inputs on failure', async () => {
    const ports = createTestPorts();
    const { productionId, articleId } = await production(ports);
    const begun = ports.runs.begin({ productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    ports.runs.sync(streamFold(begun.value.run, OPENING));
    const cancelled = ports.runs.settle(begun.value.run.id, { status: 'cancelled' });
    assert.ok(cancelled.ok);
    const [partial] = cancelled.value.versions;
    assert.equal(partial.interrupted, true);
    assert.ok(partial.body.type === 'article' && partial.body.blocks.length === 2, 'the partial heading is cut at a word boundary');

    const failing = ports.runs.begin({ productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS, retryOfRunId: begun.value.run.id });
    assert.ok(failing.ok);
    const before = await ports.queries.draft(articleId);
    const failed = ports.runs.settle(failing.value.run.id, { status: 'failed', error: { code: 'timeout', message: 'Tempo esgotado.', retryable: true } });
    assert.ok(failed.ok);
    assert.deepEqual(failed.value.versions, []);
    assert.equal(failed.value.run.error?.code, 'timeout');
    assert.equal(failed.value.run.retryOfRunId, begun.value.run.id);
    assert.deepEqual(await ports.queries.draft(articleId), before, 'a failure without output keeps the draft');
  });

  it('turns streamed suggestions ready when the assist run completes', async () => {
    const ports = createTestPorts();
    const { productionId, articleId } = await production(ports);
    const draft = await ports.queries.draft(articleId);
    assert.ok(draft.ok);
    await ports.commands.saveDraft(articleId, { type: 'article', title: 'T', blocks: [paragraphBlock('p-1', 'A torrefação mudou a nossa margem.')] }, draft.value.revision);
    const begun = ports.runs.begin({ productionId, kind: 'article.assist', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    const put = ports.runs.putSuggestion({ id: 'sug-a', runId: begun.value.run.id, pieceId: articleId, target: [{ blockId: 'p-1', from: 0, to: 13 }], proposal: { kind: 'replace-text', text: 'O torrador' }, state: 'streaming' });
    assert.ok(put.ok);
    assert.deepEqual(put.value.anchorText, ['A torrefação ']);
    const pending = await ports.commands.decideSuggestion('sug-a', 'accept');
    assert.equal(pending.ok, false, 'a streaming suggestion cannot be applied yet');
    assert.ok(ports.runs.settle(begun.value.run.id, { status: 'completed' }).ok);
    const applied = await ports.commands.decideSuggestion('sug-a', 'accept');
    assert.ok(applied.ok && applied.value.outcome === 'applied');
    const notDiscarded = await ports.commands.decideSuggestion('sug-a', 'restore');
    assert.equal(!notDiscarded.ok && notDiscarded.refusal.code, 'not_discarded', 'an applied suggestion never comes back');
  });

  it('"Desfazer" right after "Descartar" opens the suggestion again, as it was', async () => {
    const ports = createTestPorts();
    const { productionId, articleId } = await production(ports);
    const draft = await ports.queries.draft(articleId);
    assert.ok(draft.ok);
    await ports.commands.saveDraft(articleId, { type: 'article', title: 'T', blocks: [paragraphBlock('p-1', 'A torrefação mudou a nossa margem.')] }, draft.value.revision);
    const begun = ports.runs.begin({ productionId, kind: 'article.assist', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    const put = ports.runs.putSuggestion({ id: 'sug-b', runId: begun.value.run.id, pieceId: articleId, target: [{ blockId: 'p-1', from: 0, to: 13 }], proposal: { kind: 'replace-text', text: 'O torrador' }, state: 'streaming' });
    assert.ok(put.ok);
    assert.ok(ports.runs.settle(begun.value.run.id, { status: 'completed' }).ok);
    const discarded = await ports.commands.decideSuggestion('sug-b', 'discard');
    assert.ok(discarded.ok && discarded.value.outcome === 'discarded');
    const restored = await ports.commands.decideSuggestion('sug-b', 'restore');
    assert.ok(restored.ok && restored.value.outcome === 'restored');
    const accepted = await ports.commands.decideSuggestion('sug-b', 'accept');
    assert.ok(accepted.ok && accepted.value.outcome === 'applied', 'the restored suggestion can be decided again');
  });

  it('settles runs left streaming by a previous page load as interrupted', async () => {
    const storage = memoryStorage();
    const first = createTestPorts({ storage });
    const { productionId } = await production(first);
    const begun = first.runs.begin({ productionId, kind: 'article.generate', prompt: PROMPT, steps: STEPS });
    assert.ok(begun.ok);
    first.runs.sync(streamFold(begun.value.run, OPENING));
    assert.ok(first.store.flush(), 'coalesced stream writes flush on demand');

    const reloaded = createTestPorts({ storage });
    assert.deepEqual(reloaded.recoveredRuns, [begun.value.run.id]);
    const detail = await reloaded.queries.get(productionId);
    assert.ok(detail.ok);
    assert.equal(detail.value.activeRuns.length, 0);
    const article = detail.value.pieces[0];
    assert.equal(article.latestVersion?.label, 'v1 · interrompida');
    assert.equal(article.checks.find((check) => check.blocking)?.status, 'fail', 'an interrupted draft cannot be approved as is');
  });

  it('records the acting member chosen through the session', async () => {
    const ports = createTestPorts();
    const switched = await ports.session.actAs?.(TEST_PEOPLE.approver);
    assert.ok(switched?.ok);
    const { productionId } = await production(ports);
    const detail = await ports.queries.get(productionId);
    assert.ok(detail.ok);
    assert.equal(detail.value.owner.id, TEST_PEOPLE.approver);
  });
});
