import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { articleHash } from '../../domain/article.ts';
import type { PieceId, ProductionId, RunId } from '../../domain/ids.ts';
import { toVersionRef } from '../../domain/piece.ts';
import { checkQuotes } from '../../domain/quotes.ts';
import { latestApproved, latestVersion, pieceOfKind } from '../../domain/record.ts';
import type { ProductionRecord } from '../../domain/record.ts';
import { sameVersionRef } from '../../domain/refs.ts';
import { applyRunEvent, articleBodyFromRun, foldRun, hasUsableOutput } from '../../domain/run-events.ts';
import type { RunEvent, RunFold } from '../../domain/run-events.ts';
import { resolveSourceRef } from '../../domain/source.ts';
import type { GenerationInputs, GenerationKind, GenerationService, RunUpdate, StartOptions } from '../generation.ts';

/**
 * GenerationService contract. The local simulation runs it now; a provider adapter (AI SDK
 * stream mapped onto RunEvent) must pass the same suite. Runs are observed through the port
 * only; the record is read back to check what the backend settled (versions, suggestions).
 */

export type GenerationUnderTest = {
  generation: GenerationService;
  /** A production with authorised interview material (≥ 300 words, two speakers answering) and an article piece. */
  productionId: ProductionId;
  articlePieceId: PieceId;
  /** The production record as the backend holds it after applying run updates. */
  record(): ProductionRecord | Promise<ProductionRecord>;
  /** Approves the latest article version and makes sure the carousel piece exists. */
  approveArticleAndDerive(): Promise<{ carouselPieceId: PieceId }>;
  dispose?(): void | Promise<void>;
};

export type GenerationFactory = () => GenerationUnderTest | Promise<GenerationUnderTest>;

type Observed = { runId: RunId; events: RunEvent[]; updates: RunUpdate[]; fold: RunFold };

const TERMINAL = new Set(['run.completed', 'run.failed', 'run.cancelled']);

async function using(make: GenerationFactory, test: (sut: GenerationUnderTest) => Promise<void>): Promise<void> {
  const sut = await make();
  try {
    await test(sut);
  } finally {
    await sut.dispose?.();
  }
}

/** Starts a run and waits for its end; `onUpdate` may act mid-stream (cancel…). */
export async function runToEnd<K extends GenerationKind>(
  generation: GenerationService,
  kind: K,
  input: GenerationInputs[K],
  options: StartOptions = {},
  onUpdate?: (update: RunUpdate, runId: RunId) => void,
): Promise<Observed> {
  const updates: RunUpdate[] = [];
  let runId: RunId | undefined;
  const stop = generation.watch((update) => {
    updates.push(update);
    if (runId && update.event.runId === runId) onUpdate?.(update, runId);
  });
  try {
    const started = await generation.start(kind, input, options);
    if (!started.ok) throw new Error(`start refused: ${started.refusal.code} (${started.refusal.message})`);
    runId = started.value.runId;
    const attached = await generation.attach(runId);
    if (!attached.ok) throw new Error(`attach refused: ${attached.refusal.code}`);
    for await (const event of attached.value.events) void event;
    const own = updates.filter((update) => update.event.runId === runId);
    return { runId, events: own.map((update) => update.event), updates, fold: own[own.length - 1].fold };
  } finally {
    stop();
  }
}

function assertStreamShape(events: readonly RunEvent[]): void {
  assert.equal(events[0]?.type, 'run.started', 'the first event is run.started');
  events.forEach((event, index) => assert.equal(event.seq, index + 1, 'seq is contiguous from 1'));
  const last = events[events.length - 1];
  assert.ok(last && TERMINAL.has(last.type), 'the last event is terminal');
  assert.equal(events.filter((event) => TERMINAL.has(event.type)).length, 1, 'exactly one terminal event');
  const started = new Set<string>();
  const completed = new Set<string>();
  for (const event of events) {
    if (event.type === 'block.started') started.add(event.block.id);
    if (event.type === 'text.delta') {
      assert.ok(started.has(event.blockId), `delta for ${event.blockId} after block.started`);
      assert.ok(!completed.has(event.blockId), `no delta for ${event.blockId} after block.completed`);
    }
    if (event.type === 'block.completed') completed.add(event.block.id);
  }
}

export function generationContract(name: string, make: GenerationFactory): void {
  describe(`${name} · generation contract`, () => {
    it('streams a draft whose events are ordered and fold into the final state', () =>
      using(make, async (sut) => {
        const run = await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        assertStreamShape(run.events);
        assert.equal(run.fold.run.status, 'completed');
        assert.deepEqual(foldRun([...run.events].reverse()), run.fold, 'foldRun is the only interpreter, order-independent');
        assert.ok(run.fold.run.steps.every((step) => step.state === 'done'));
        assert.ok(run.fold.blocks.length > 0 && run.fold.blocks.every((block) => block.complete));
      }));

    it('records the run context and never reports invented usage or cost', () =>
      using(make, async (sut) => {
        const run = await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        const kinds = run.fold.run.inputs.map((ref) => ref.kind);
        assert.ok(kinds.includes('source-version'), 'source version + hash');
        assert.ok(kinds.includes('brief'), 'brief snapshot');
        assert.ok(run.fold.run.prompt.key && run.fold.run.prompt.version && run.fold.run.prompt.hash);
        if (run.fold.run.model.engine === 'simulated') {
          assert.equal(run.fold.run.model.label, 'Simulação local');
          assert.equal(run.fold.run.usage, undefined);
          assert.equal(run.fold.run.cost, undefined);
        }
      }));

    it('cites only evidence that resolves in the cited source version, quoting it verbatim', () =>
      using(make, async (sut) => {
        const run = await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        const { sources } = await sut.record();
        const refs = [...run.fold.sourcesUsed, ...run.fold.blocks.flatMap((block) => block.final?.sourceRefs ?? [])];
        assert.ok(refs.length > 0, 'the draft cites the material');
        for (const ref of refs) assert.ok(resolveSourceRef(sources, ref), `ref resolves: ${JSON.stringify(ref.locator)}`);
        const quotes = checkQuotes(articleBodyFromRun(run.fold), sources);
        assert.ok(quotes.every((quote) => quote.status === 'verified'), 'every quotation matches the transcript');
      }));

    it('settles "v1 · IA" as the pure run output', () =>
      using(make, async (sut) => {
        const run = await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        const record = await sut.record();
        const version = record.versions.find((entry) => entry.runId === run.runId && entry.origin === 'generation');
        assert.ok(version, 'a generation version was created');
        assert.equal(version.hash, articleHash(articleBodyFromRun(run.fold)));
        assert.equal(version.interrupted, undefined);
        const settled = record.runs.find((entry) => entry.id === run.runId);
        assert.ok(settled?.output && sameVersionRef(settled.output, toVersionRef(version)), 'run.output points at the version');
      }));

    it('attach returns a snapshot that, with the live events, equals the whole stream', () =>
      using(make, async (sut) => {
        let snapshot: RunFold | undefined;
        let live: RunEvent[] = [];
        let attaching: Promise<void> | undefined;
        const run = await runToEnd(
          sut.generation,
          'article.draft',
          { productionId: sut.productionId, pieceId: sut.articlePieceId },
          {},
          (update, runId) => {
            if (attaching || update.event.type !== 'text.delta') return;
            attaching = (async () => {
              const attached = await sut.generation.attach(runId);
              assert.ok(attached.ok);
              snapshot = attached.value.snapshot;
              const events: RunEvent[] = [];
              for await (const event of attached.value.events) events.push(event);
              live = events;
            })();
          },
        );
        await attaching;
        assert.ok(snapshot && snapshot.seq < run.fold.seq, 'attached mid-run');
        assert.ok(live.every((event) => event.seq > (snapshot as RunFold).seq), 'no replay of events already in the snapshot');
        const resumed = live.reduce(applyRunEvent, snapshot as RunFold);
        assert.deepEqual(resumed, run.fold);
      }));

    it('cancel stops the run and keeps the partial output ("interrompida")', () =>
      using(make, async (sut) => {
        let deltas = 0;
        let cancelling: Promise<unknown> | undefined;
        const run = await runToEnd(
          sut.generation,
          'article.draft',
          { productionId: sut.productionId, pieceId: sut.articlePieceId },
          {},
          (update, runId) => {
            if (update.event.type === 'text.delta' && ++deltas === 40 && !cancelling) cancelling = sut.generation.cancel(runId);
          },
        );
        const cancelled = await cancelling;
        assert.ok(cancelled && (cancelled as { ok: boolean }).ok);
        assert.equal(run.fold.run.status, 'cancelled');
        assert.ok(hasUsableOutput(run.fold), 'the partial is kept');
        const record = await sut.record();
        const version = record.versions.find((entry) => entry.runId === run.runId);
        assert.ok(version?.interrupted, 'an interrupted version keeps what was written');
        const again = await sut.generation.cancel(run.runId);
        assert.equal(again.ok, false);
      }));

    it('a failed step keeps the inputs, and retry from that step completes', async (context) => {
      const probe = await make();
      const supported = probe.generation.scenarios().some((scenario) => scenario.id === 'fail-section');
      await probe.dispose?.();
      if (!supported) {
        context.skip('adapter has no failure scenarios');
        return;
      }
      await using(make, async (sut) => {
        const failed = await runToEnd(
          sut.generation,
          'article.draft',
          { productionId: sut.productionId, pieceId: sut.articlePieceId },
          { simulation: 'fail-section' },
        );
        assert.equal(failed.fold.run.status, 'failed');
        const failedStep = failed.fold.run.error?.stepId;
        assert.ok(failedStep, 'the error names the failed step');
        const startedEvent = failed.events[0];
        assert.ok(startedEvent.type === 'run.started');
        assert.deepEqual(failed.fold.run.inputs, startedEvent.inputs, 'inputs survive the failure');

        const updates: RunUpdate[] = [];
        const stop = sut.generation.watch((update) => updates.push(update));
        const retried = await sut.generation.retry(failed.runId);
        assert.ok(retried.ok);
        const attached = await sut.generation.attach(retried.value.runId);
        assert.ok(attached.ok);
        for await (const event of attached.value.events) void event;
        stop();
        const own = updates.filter((update) => update.event.runId === retried.value.runId);
        const fold = own[own.length - 1].fold;
        assert.equal(fold.run.status, 'completed');
        assert.equal(fold.run.retryOfRunId, failed.runId);
        const kept = failed.fold.blocks.filter((block) => block.complete);
        const failedIndex = failed.fold.run.steps.findIndex((step) => step.id === failedStep);
        assert.ok(failedIndex > 0);
        for (const block of kept.slice(0, 1)) {
          const again = fold.blocks.find((candidate) => candidate.id === block.id);
          assert.ok(again && again.text === block.text, 'finished output before the failed step is reused');
        }
      });
    });

    it('inline suggestions never touch the document', () =>
      using(make, async (sut) => {
        await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        const before = await sut.record();
        const piece = before.pieces.find((entry) => entry.id === sut.articlePieceId);
        assert.ok(piece && piece.draft.body.type === 'article');
        const body = piece.draft.body;
        const run = await runToEnd(sut.generation, 'article.titles', {
          productionId: sut.productionId,
          pieceId: sut.articlePieceId,
          baseRevision: piece.draft.revision,
          body,
        });
        assert.equal(run.fold.run.status, 'completed');
        assert.ok(run.fold.suggestions.length > 0 && run.fold.suggestions.length <= 3);
        assert.ok(run.fold.suggestions.every((suggestion) => suggestion.proposal.kind === 'title'));
        const after = await sut.record();
        const draft = after.pieces.find((entry) => entry.id === sut.articlePieceId)?.draft;
        assert.equal(draft?.revision, piece.draft.revision, 'the draft revision did not move');
        const stored = after.suggestions.filter((suggestion) => suggestion.runId === run.runId);
        assert.equal(stored.length, run.fold.suggestions.length);
        assert.ok(stored.every((suggestion) => suggestion.state === 'ready'));
      }));

    it('writes carousel copy only from the approved article version, and records it as input', () =>
      using(make, async (sut) => {
        await runToEnd(sut.generation, 'article.draft', { productionId: sut.productionId, pieceId: sut.articlePieceId });
        const { carouselPieceId } = await sut.approveArticleAndDerive();
        const record = await sut.record();
        const article = pieceOfKind(record, 'article');
        const approved = article ? latestApproved(record, article.id) : undefined;
        assert.ok(approved);
        const run = await runToEnd(sut.generation, 'carousel.copy', { productionId: sut.productionId, pieceId: carouselPieceId });
        assert.equal(run.fold.run.status, 'completed');
        assert.ok(run.fold.slides.length >= 3);
        assert.ok(run.fold.run.inputs.some((ref) => ref.kind === 'version' && sameVersionRef(ref, approved.ref)));
        const articleIds = new Set((approved.version.body.type === 'article' ? approved.version.body.blocks : []).map((block) => block.id));
        for (const slide of run.fold.slides) {
          assert.ok(slide.sourceBlockIds.every((id) => articleIds.has(id)), 'slides point at blocks of the approved version');
          assert.ok(Object.values(slide.slots).some((text) => text.trim().length > 0));
        }
        const after = await sut.record();
        const carousel = after.pieces.find((entry) => entry.id === carouselPieceId);
        const version = carousel ? latestVersion(after, carousel.id) : undefined;
        assert.ok(version && version.origin === 'generation');
        assert.ok(sameVersionRef(version.inputs[0], approved.ref), 'the carousel version derives from the approved article');
      }));
  });
}
