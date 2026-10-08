import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { articleCharacters } from '../../../domain/article.ts';
import { ARTICLE_SIZES, expectedDraftChars, SIZE_TOLERANCE } from '../../../domain/sizing.ts';
import { checkQuotes } from '../../../domain/quotes.ts';
import { pendingReview, pieceOfKind } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { canGenerate } from '../../../domain/rules/generate.ts';
import { articleBodyFromRun, outlineProposalOf } from '../../../domain/run-events.ts';
import { isRunActive } from '../../../domain/run.ts';
import { currentSourceVersion, resolveSourceRef } from '../../../domain/source.ts';
import { createFixtures, fixtureSeed } from '../../../fixtures/index.ts';
import { createLocalStore } from '../store/local-store.ts';
import { createRecordAccess } from '../store/record-access.ts';
import { createIdGenerator, manualClock } from '../store/system.ts';
import { createLocalGenerationService } from './local-generation.ts';
import { materialOutlook } from './outlook.ts';
import { applyRunUpdate } from './record-sync.ts';
import { instantSleep } from './testing.ts';

/** The real fixture workspace through the local store and the simulated generation. */
function workspace() {
  const now = '2026-10-07T12:00:00.000Z';
  const set = createFixtures({ now });
  const clock = manualClock(now);
  const ids = createIdGenerator({ salt: 'test' });
  const store = createLocalStore({ seed: () => fixtureSeed(set), clock, ids });
  const records = createRecordAccess(store);
  const generation = createLocalGenerationService({
    clock,
    ids,
    getRecord: (productionId) => records.record(productionId),
    actorId: () => set.viewerId,
    scripts: set.scriptBook,
    templates: () => set.templates,
    people: () => store.state.people,
    sleep: instantSleep(clock),
  });
  generation.watch((update) => {
    records.apply(update.meta.productionId, (record, ctx) => applyRunUpdate(record, update, ctx), { runFold: update.fold });
  });
  const all = (): ProductionRecord[] => set.records.map((record) => records.record(record.production.id) as ProductionRecord);
  return { set, store, records, generation, all };
}

async function finish(generation: ReturnType<typeof workspace>['generation'], runId: string) {
  const attached = await generation.attach(runId);
  assert.ok(attached.ok);
  for await (const event of attached.value.events) void event;
  const again = await generation.attach(runId);
  assert.ok(again.ok);
  return again.value.snapshot;
}

describe('fixtures through the simulated generation', () => {
  it('continues the flagship run that is mid-stream when the app opens, from its hand-written script', async () => {
    const { set, records, generation } = workspace();
    const live = Object.values(records.runFolds()).filter((fold) => isRunActive(fold.run) && !fold.run.parentRunId);
    assert.ok(live.length >= 1, 'the fixtures seed a live run');
    const fold = live[0];
    const before = fold.seq;
    const adopted = await generation.adopt(fold);
    assert.ok(adopted.ok);
    const final = await finish(generation, adopted.value.runId);
    assert.equal(final.run.status, 'completed');
    assert.ok(final.seq > before, 'the same run went on (seq continues)');
    assert.ok(final.run.steps.every((step) => step.state === 'done'));

    const record = records.record(fold.run.productionId) as ProductionRecord;
    const version = record.versions.find((entry) => entry.runId === fold.run.id && entry.origin === 'generation');
    assert.ok(version && version.body.type === 'article', 'v1 · IA settled from the adopted run');
    const source = record.sources[0];
    const script = set.scriptBook.draft(source.id);
    assert.ok(script);
    const scripted = script.sections.flatMap((section) => section.blocks.map((block) => block.id));
    assert.deepEqual(version.body.blocks.map((block) => block.id), scripted, 'the stream is the hand-written script');
    assert.ok(checkQuotes(version.body, record.sources).every((quote) => quote.status === 'verified'));
    const again = await generation.adopt(fold);
    assert.ok(again.ok && again.value.runId === fold.run.id, 'adopting a run already driven here is a no-op');
    const finished = await generation.adopt(final);
    assert.equal(!finished.ok && finished.refusal.code, 'not_running');
  });

  it('every scripted production can generate a draft whose evidence resolves and whose quotes are verbatim', async () => {
    const { set, generation, all } = workspace();
    const scripted = new Set(set.scriptBook.sourceIds());
    // A piece waiting for approval is locked: nothing may rewrite it until the request is withdrawn.
    const unlocked = (record: ProductionRecord) => {
      const article = pieceOfKind(record, 'article');
      return article !== undefined && pendingReview(record, article.id) === undefined;
    };
    const candidates = all().filter((record) => record.sources.some((source) => scripted.has(source.id)) && canGenerate(record, 'article').ok && unlocked(record));
    assert.ok(candidates.length >= 1);
    for (const record of candidates) {
      const article = pieceOfKind(record, 'article');
      assert.ok(article);
      const started = await generation.start('article.draft', { productionId: record.production.id, pieceId: article.id });
      assert.ok(started.ok, started.ok ? '' : started.refusal.message);
      const fold = await finish(generation, started.value.runId);
      assert.equal(fold.run.status, 'completed', record.production.title);
      const body = articleBodyFromRun(fold);
      for (const block of body.blocks) {
        for (const ref of block.sourceRefs ?? []) assert.ok(resolveSourceRef(record.sources, ref), `${record.production.title}: ${block.id}`);
      }
      assert.ok(checkQuotes(body, record.sources).every((quote) => quote.status === 'verified'), record.production.title);
    }
  });

  it('a fixture writes from its material once the brief is edited: the new sections and length, not the script (A08)', async () => {
    const { set, records, generation } = workspace();
    const id = 'prod-estudio-norte';
    const record = records.record(id) as ProductionRecord;
    const article = pieceOfKind(record, 'article');
    assert.ok(article);
    const script = set.scriptBook.draft(record.sources[0].id);
    assert.ok(script?.brief, 'the script knows the brief it answers');
    const scripted = await finish(generation, (await generation.start('article.draft', { productionId: id, pieceId: article.id }).then((started) => {
      assert.ok(started.ok);
      return started.value.runId;
    })));
    assert.deepEqual(articleBodyFromRun(scripted).blocks.map((block) => block.id), script.sections.flatMap((section) => section.blocks.map((block) => block.id)));

    records.apply(id, (current) => ({ ...current, production: { ...current.production, brief: { ...current.production.brief, sections: 4, size: 'standard', revision: current.production.brief.revision + 1 } } }));
    const started = await generation.start('article.draft', { productionId: id, pieceId: article.id });
    assert.ok(started.ok, started.ok ? '' : started.refusal.message);
    const fold = await finish(generation, started.value.runId);
    assert.equal(fold.run.status, 'completed');
    const body = articleBodyFromRun(fold);
    assert.equal(body.blocks.filter((block) => block.type === 'heading').length, 4, 'four intertítulos, as the new brief asks');
    // As long as the material allows (a short interview gives all it has, never padded), never above the size.
    const chars = articleCharacters(body);
    const expected = expectedDraftChars('standard', materialOutlook(currentSourceVersion(record.sources[0]).content.segments).charsAvailable);
    assert.ok(Math.abs(chars - expected.chars) <= expected.chars * SIZE_TOLERANCE, `${chars} caracteres; a prévia promete ${expected.chars}`);
    assert.ok(chars <= ARTICLE_SIZES.standard.maxChars, `${chars} caracteres passam de 2 laudas`);
    assert.notDeepEqual(body.blocks.map((block) => block.id), script.sections.flatMap((section) => section.blocks.map((block) => block.id)));
    assert.ok(checkQuotes(body, records.record(id)?.sources ?? []).every((quote) => quote.status === 'verified'));
  });

  it('a scripted fixture\'s structure writes its hand-written text as proposed, and the material once edited', async () => {
    const { set, records, generation } = workspace();
    const id = 'prod-horizonte';
    const record = records.record(id) as ProductionRecord;
    const article = pieceOfKind(record, 'article');
    assert.ok(article);
    const script = set.scriptBook.draft(record.sources[0].id);
    assert.ok(script);
    const started = await generation.start('article.outline', { productionId: id, pieceId: article.id });
    assert.ok(started.ok, started.ok ? '' : started.refusal.message);
    const proposal = outlineProposalOf(await finish(generation, started.value.runId));
    assert.ok(proposal);
    assert.equal(proposal.title, script.title);
    assert.deepEqual(proposal.sections.map((section) => section.title), script.outline.map((section) => section.title));
    const outline = {
      title: proposal.title,
      intro: { quotes: proposal.intro.quotes },
      sections: proposal.sections.map((section) => ({ ...(section.blockId ? { blockId: section.blockId } : {}), title: section.title, quotes: section.quotes ?? [] })),
      fromRunId: started.value.runId,
    };
    const asProposed = await generation.start('article.draft', { productionId: id, pieceId: article.id, outline });
    assert.ok(asProposed.ok, asProposed.ok ? '' : asProposed.refusal.message);
    const scripted = articleBodyFromRun(await finish(generation, asProposed.value.runId));
    assert.deepEqual(scripted.blocks.map((block) => block.id), script.sections.flatMap((section) => section.blocks.map((block) => block.id)), 'the hand-written text');
    const edited = await generation.start('article.draft', { productionId: id, pieceId: article.id, outline: { ...outline, sections: [...outline.sections].reverse() } });
    assert.ok(edited.ok, edited.ok ? '' : edited.refusal.message);
    const body = articleBodyFromRun(await finish(generation, edited.value.runId));
    assert.deepEqual(body.blocks.filter((block) => block.type === 'heading').map((block) => block.inlines.map((inline) => inline.text).join('')), [...outline.sections].reverse().map((section) => section.title));
    assert.ok(articleCharacters(body) <= ARTICLE_SIZES.standard.maxChars);
    assert.ok(checkQuotes(body, record.sources).every((quote) => quote.status === 'verified'));
  });

  it('refuses to rewrite a piece that waits for approval, naming who has it (D8)', async () => {
    const { set, generation, all } = workspace();
    const waiting = all().flatMap((record) =>
      record.pieces.flatMap((piece) => {
        const request = pendingReview(record, piece.id);
        return request ? [{ record, piece, request }] : [];
      }),
    );
    assert.ok(waiting.length >= 1, 'the fixtures have a piece waiting for approval');
    for (const { record, piece, request } of waiting) {
      const input = { productionId: record.production.id, pieceId: piece.id };
      const started = piece.kind === 'article' ? await generation.start('article.draft', input) : await generation.start('carousel.copy', input);
      assert.equal(!started.ok && started.refusal.code, 'locked', record.production.title);
      const message = started.ok ? '' : started.refusal.message;
      assert.match(message, /Retire o envio para editar\.$/);
      const assignee = request.assigneeId ? set.people.find((person) => person.id === request.assigneeId) : undefined;
      if (assignee) assert.ok(message.includes(`com ${assignee.name.split(' ')[0]} para aprovação`), message);
      if (piece.kind === 'article') {
        const outline = await generation.start('article.outline', input);
        assert.equal(!outline.ok && outline.refusal.code, 'locked');
      }
    }
  });

  it('writes carousel copy for a production whose article is approved', async () => {
    const { generation, all } = workspace();
    const ready = all().find((record) => {
      const carousel = pieceOfKind(record, 'carousel');
      return carousel !== undefined && pendingReview(record, carousel.id) === undefined && canGenerate(record, 'carousel').ok;
    });
    assert.ok(ready, 'a fixture has an approved article and a carousel piece');
    const carousel = pieceOfKind(ready, 'carousel');
    assert.ok(carousel);
    const started = await generation.start('carousel.copy', { productionId: ready.production.id, pieceId: carousel.id });
    assert.ok(started.ok, started.ok ? '' : started.refusal.message);
    const fold = await finish(generation, started.value.runId);
    assert.equal(fold.run.status, 'completed');
    assert.ok(fold.slides.length >= 3);
    assert.equal(fold.run.model.label, 'Simulação local');
  });
});
