import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { describe, it } from 'node:test';
import { blockText, paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { articleBodyFromRun } from '../../../domain/run-events.ts';
import { generationContract, runToEnd } from '../../../ports/contracts/generation.contract.ts';
import { OUTLINE_REVIEW } from '../../../ports/generation.ts';
import type { ScriptBook } from '../../../ports/script-book.ts';
import { recoverOrphanRuns } from './record-sync.ts';
import { ARTICLE_PIECE, CAROUSEL_PIECE, createHarness, PRODUCTION_ID } from './testing.ts';
import type { Harness } from './testing.ts';

generationContract('local simulation', () => {
  const harness = createHarness();
  return {
    generation: harness.service,
    productionId: PRODUCTION_ID,
    articlePieceId: ARTICLE_PIECE,
    record: () => harness.record(),
    async approveArticleAndDerive() {
      harness.approveLatestArticle();
      harness.addCarouselPiece();
      return { carouselPieceId: CAROUSEL_PIECE };
    },
  };
});

const DRAFT = { productionId: PRODUCTION_ID, pieceId: ARTICLE_PIECE };

async function draftOf(harness: Harness): Promise<{ body: ArticleBody; revision: number }> {
  await runToEnd(harness.service, 'article.draft', DRAFT);
  const piece = harness.record().pieces.find((entry) => entry.id === ARTICLE_PIECE);
  assert.ok(piece && piece.draft.body.type === 'article');
  return { body: piece.draft.body, revision: piece.draft.revision };
}

describe('local generation · finished runs', () => {
  it('let go of the caller\'s abort listener and of the word-by-word deltas; the snapshot stays', async () => {
    const harness = createHarness();
    const caller = new AbortController();
    const started = await harness.service.start('article.draft', { productionId: PRODUCTION_ID, pieceId: ARTICLE_PIECE }, { signal: caller.signal });
    assert.ok(started.ok);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 1, 'aborting the caller stops a live run');
    const attached = await harness.service.attach(started.value.runId);
    assert.ok(attached.ok);
    let deltas = 0;
    for await (const event of attached.value.events) if (event.type === 'text.delta') deltas += 1;
    assert.ok(deltas > 0, 'the run streamed word by word');
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0, 'no listener left on the caller once it ended');
    const again = await harness.service.attach(started.value.runId);
    assert.ok(again.ok && again.value.snapshot.run.status === 'completed');
    assert.ok(articleBodyFromRun(again.value.snapshot).blocks.length > 0, 'the text is still in the snapshot');
  });
});

describe('local generation · article draft', () => {
  it('follows the registry recipe: material → key quotes → outline → intro → sections → quote check', async () => {
    const harness = createHarness();
    const run = await runToEnd(harness.service, 'article.draft', DRAFT);
    assert.deepEqual(
      run.fold.run.steps.map((step) => step.id),
      ['read', 'select', 'outline', 'intro', 'section-1', 'section-2', 'section-3', 'quotes'],
    );
    assert.match(run.fold.run.steps[0].meta ?? '', /^\d+ falas · 3 falantes$/);
    assert.match(run.fold.run.steps[7].meta ?? '', /^(\d+) de \1 conferidas$/);
    assert.equal(run.fold.outline.length, 3);
    assert.ok(run.fold.sourcesUsed.length >= 3, 'key quotes are announced as SourceChips');
    const children = harness.record().runs.filter((entry) => entry.parentRunId === run.runId);
    assert.equal(children.length, 4, 'one child run per writing step (intro + 3 sections)');
    assert.ok(children.every((child) => child.kind === 'article.section' && child.status === 'completed'));
  });

  it('is extractive for pasted material: verbatim headings and reported speech, never more than the transcript says', async () => {
    const harness = createHarness();
    const run = await runToEnd(harness.service, 'article.draft', DRAFT);
    const body = articleBodyFromRun(run.fold);
    const material = harness.record().sources[0].versions[0].content.segments.map((segment) => segment.text).join(' ');
    const headings = body.blocks.filter((block) => block.type === 'heading').map(blockText);
    assert.ok(headings.length > 0 && headings.every((heading) => !heading.endsWith('?')), 'headings come from the answers, not the questions');
    const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
    // D10: as much of the material as the length asks, never more than it holds (questions are never copied).
    assert.ok(words(body.blocks.map(blockText).join(' ')) < words(material));
    assert.ok(body.blocks.every((block) => block.ai === 'unreviewed'));
    const paragraphs = body.blocks.filter((block) => block.type === 'paragraph').map(blockText);
    assert.ok(paragraphs.every((text) => !/^[^“]+: /.test(text)), 'no transcript-style "Nome:" prefixes');
    assert.ok(paragraphs.some((text) => /”, (diz|afirma|conta|explica|observa|completa) /.test(text)), 'answers are reported speech with the speaker named');
  });

  it('refuses unauthorised material before any run starts (REQ-T.1)', async () => {
    const harness = createHarness({ authorized: false });
    const started = await harness.service.start('article.draft', DRAFT);
    assert.equal(started.ok, false);
    assert.equal(!started.ok && started.refusal.code, 'source_not_authorized');
    assert.equal(harness.record().runs.length, 0);
  });

  it('refuses material too short for an article', async () => {
    const harness = createHarness({ transcript: 'Entrevistadora: Tudo bem?\nLúcia Prado: Tudo ótimo, obrigada.' });
    const started = await harness.service.start('article.draft', DRAFT);
    assert.equal(!started.ok && started.refusal.code, 'material_too_short');
  });

  it('pauses for the outline review and resumes with the edited headings (REQ-3.8 plug)', async () => {
    const harness = createHarness();
    const updates: string[] = [];
    let resumed: Promise<unknown> | undefined;
    const run = await runToEnd(harness.service, 'article.draft', DRAFT, { reviewOutline: true }, (update, runId) => {
      updates.push(update.event.type);
      if (update.event.type === 'step.awaiting_input') {
        assert.equal(update.fold.run.status, 'awaiting_input');
        assert.equal(update.event.request.kind, OUTLINE_REVIEW);
        const sections = update.fold.outline.map((section, index) => ({ ...section, title: `Parte ${index + 1}` }));
        resumed = harness.service.resume(runId, { sections });
      }
    });
    assert.ok((await resumed) && updates.includes('step.awaiting_input'));
    assert.equal(run.fold.run.status, 'completed');
    const headings = articleBodyFromRun(run.fold).blocks.filter((block) => block.type === 'heading').map(blockText);
    assert.deepEqual(headings, ['Parte 1', 'Parte 2', 'Parte 3']);
    const invalid = await harness.service.resume(run.runId, { sections: [] });
    assert.equal(!invalid.ok && invalid.refusal.code, 'not_awaiting');
  });

  it('retrying a failed section reuses everything before it and records the lineage', async () => {
    const harness = createHarness();
    const failed = await runToEnd(harness.service, 'article.draft', DRAFT, { simulation: 'fail-section' });
    assert.equal(failed.fold.run.error?.stepId, 'section-2');
    assert.equal(failed.fold.run.steps.find((step) => step.id === 'section-2')?.state, 'error');
    const failedChild = harness.record().runs.find((entry) => entry.parentRunId === failed.runId && entry.status === 'failed');
    assert.ok(failedChild, 'the section child run failed too');
    const interrupted = harness.record().versions.find((version) => version.runId === failed.runId);
    assert.ok(interrupted?.interrupted, 'finished sections are kept as an interrupted version');

    const retried = await harness.service.retry(failedChild.id);
    assert.ok(retried.ok, 'a child run retries through its parent');
    const run = await harness.finish(retried.value.runId);
    assert.equal(run.fold.run.status, 'completed');
    assert.equal(run.fold.run.retryOfRunId, failed.runId);
    const reused = run.fold.run.steps.filter((step) => step.meta === 'Reaproveitado da tentativa anterior').map((step) => step.id);
    assert.deepEqual(reused, ['read', 'select', 'outline', 'intro', 'section-1']);
    const children = harness.record().runs.filter((entry) => entry.parentRunId === retried.value.runId);
    assert.deepEqual(children.length, 2, 'only section 2 and section 3 run again');
    const versions = harness.record().versions.filter((version) => version.runId === retried.value.runId);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].interrupted, undefined);
  });

  it('"Continuar de onde parou" after a cancel resumes at the next unfinished step', async () => {
    const harness = createHarness();
    let cancelling: Promise<unknown> | undefined;
    const cancelled = await runToEnd(harness.service, 'article.draft', DRAFT, {}, (update, runId) => {
      if (update.event.type === 'step.completed' && update.event.stepId === 'section-1' && !cancelling) cancelling = harness.service.cancel(runId);
    });
    await cancelling;
    assert.equal(cancelled.fold.run.status, 'cancelled');
    const retried = await harness.service.retry(cancelled.runId);
    assert.ok(retried.ok);
    const run = await harness.finish(retried.value.runId);
    assert.equal(run.fold.run.status, 'completed');
    assert.equal(run.fold.run.steps.find((step) => step.id === 'section-1')?.meta, 'Reaproveitado da tentativa anterior');
    const nothing = await harness.service.retry(retried.value.runId);
    assert.equal(!nothing.ok && nothing.refusal.code, 'nothing_to_retry');
  });

  it('a regeneration freezes unsaved edits as a version before streaming (never mixed into v2 · IA)', async () => {
    const harness = createHarness();
    const { body } = await draftOf(harness);
    const edited: ArticleBody = { ...body, blocks: [paragraphBlock('b-mine', 'Texto escrito pela editora.'), ...body.blocks] };
    harness.store.transact((state) => {
      const productions = state.productions.map((entry) => ({
        ...entry,
        pieces: entry.pieces.map((piece) =>
          piece.id === ARTICLE_PIECE ? { ...piece, draft: { ...piece.draft, body: edited, revision: piece.draft.revision + 1, updatedAt: harness.clock.now() } } : piece,
        ),
      }));
      return { ok: true as const, value: { state: { ...state, productions }, value: true, persist: 'none' as const } };
    });
    const run = await runToEnd(harness.service, 'article.draft', DRAFT);
    const versions = harness.record().versions.sort((a, b) => a.number - b.number);
    assert.deepEqual(
      versions.map((version) => version.origin),
      ['generation', 'edit', 'generation'],
    );
    assert.equal(versions[2].runId, run.runId);
    assert.ok(versions[1].body.type === 'article' && versions[1].body.blocks[0].id === 'b-mine', 'the edit was frozen as its own version');
    assert.ok(versions[2].body.type === 'article' && versions[2].body.blocks.every((block) => block.id !== 'b-mine'), 'v3 · IA is pure');
  });

  it('uses hand-written scripts for fixture material and keeps their block ids', async () => {
    const harness = createHarness();
    const source = harness.record().sources[0];
    const segments = source.versions[0].content.segments;
    const answer = segments.find((segment) => segment.speaker === 'Lúcia Prado');
    assert.ok(answer);
    const ref = { kind: 'source' as const, sourceId: source.id, sourceVersion: 1, locator: { type: 'segment' as const, segmentId: answer.id } };
    const scripts: ScriptBook = {
      sourceIds: () => [source.id],
      draft: () => ({
        sourceId: source.id,
        sourceVersion: 1,
        title: 'Fermento Vivo: a padaria que virou cooperativa',
        keySegments: [ref],
        outline: [{ blockId: 'fx-h1', title: 'Da cozinha ao galpão' }],
        sections: [
          { id: 'intro', label: 'Introdução', blocks: [paragraphBlock('fx-intro', 'A Padaria Fermento Vivo começou em 2018.', { sourceRefs: [ref] })] },
          {
            id: 'section-1',
            label: 'Seção 1',
            blocks: [
              { id: 'fx-h1', type: 'heading', level: 2, inlines: [{ text: 'Da cozinha ao galpão' }] },
              paragraphBlock('fx-p1', 'Lúcia fazia a massa de madrugada.', { sourceRefs: [ref] }),
            ],
          },
        ],
      }),
      rewrite: (_, blockId, variant) => (blockId === 'fx-p1' && variant === 'formal' ? 'Lúcia preparava a massa durante a madrugada.' : undefined),
      titles: () => ['Um', 'Dois', 'Três', 'Quatro'],
      subheadings: () => ['Do forno doméstico ao coletivo'],
      carousel: () => undefined,
    };
    const scripted = createHarness({ scripts });
    const run = await runToEnd(scripted.service, 'article.draft', DRAFT);
    const body = articleBodyFromRun(run.fold);
    assert.equal(body.title, 'Fermento Vivo: a padaria que virou cooperativa');
    assert.deepEqual(body.blocks.map((block) => block.id), ['fx-intro', 'fx-h1', 'fx-p1']);
    assert.deepEqual(run.fold.run.steps.map((step) => step.id), ['read', 'select', 'outline', 'intro', 'section-1', 'quotes']);

    const piece = scripted.record().pieces.find((entry) => entry.id === ARTICLE_PIECE);
    assert.ok(piece && piece.draft.body.type === 'article');
    const target = [{ blockId: 'fx-p1', from: 0, to: blockText(piece.draft.body.blocks[2]).length }];
    const formal = await runToEnd(scripted.service, 'article.rewrite', { ...DRAFT, baseRevision: piece.draft.revision, body: piece.draft.body, target, tone: 'formal' });
    assert.deepEqual(formal.fold.suggestions[0].proposal, { kind: 'replace-text', text: 'Lúcia preparava a massa durante a madrugada.' });
    const titles = await runToEnd(scripted.service, 'article.titles', { ...DRAFT, baseRevision: piece.draft.revision, body: piece.draft.body });
    assert.deepEqual(titles.fold.suggestions.map((entry) => entry.proposal.kind === 'title' && entry.proposal.text), ['Um', 'Dois', 'Três']);
    const subheadings = await runToEnd(scripted.service, 'article.subheadings', { ...DRAFT, baseRevision: piece.draft.revision, body: piece.draft.body });
    assert.deepEqual(subheadings.fold.suggestions[0].proposal, { kind: 'replace-text', text: 'Do forno doméstico ao coletivo' });
  });
});

describe('local generation · inline actions', () => {
  it('rewrite, shorten, expand and list stream a preview and end in ready suggestions', async () => {
    const harness = createHarness();
    const { body, revision } = await draftOf(harness);
    const paragraph = body.blocks.find((block) => block.type === 'paragraph' && blockText(block).split(/[.!?]\s/).length >= 2 && block.sourceRefs);
    assert.ok(paragraph);
    const whole = [{ blockId: paragraph.id, from: 0, to: blockText(paragraph).length }];
    const base = { ...DRAFT, baseRevision: revision, body };

    const list = await runToEnd(harness.service, 'article.to-list', { ...base, target: whole });
    assert.equal(list.fold.suggestions[0].proposal.kind, 'replace-blocks');
    const listId = list.fold.suggestions[0].id;
    assert.ok(list.fold.blocks.some((block) => block.id === listId), 'the proposal streams as a preview block');

    // "Expandir com a fonte" needs a paragraph whose source line still has words outside the text.
    const candidates = [paragraph, ...body.blocks.filter((block) => block.type === 'paragraph' && block.sourceRefs && block.id !== paragraph.id)];
    let expand: Awaited<ReturnType<typeof runToEnd>> | undefined;
    for (const block of candidates) {
      try {
        expand = await runToEnd(harness.service, 'article.expand-from-source', { ...base, target: [{ blockId: block.id, from: 0, to: blockText(block).length }] });
        break;
      } catch {
        continue;
      }
    }
    assert.ok(expand, 'some paragraph can be expanded from its source');
    const proposal = expand.fold.suggestions[0]?.proposal;
    assert.ok(proposal?.kind === 'replace-blocks' && proposal.blocks.length === 2, 'the original block plus a sourced addition');
    assert.ok(expand.fold.sourcesUsed.length === 1);

    const stored = harness.record().suggestions;
    assert.ok(stored.length >= 2 && stored.every((suggestion) => suggestion.state === 'ready'));
    const unchanged = harness.record().pieces.find((piece) => piece.id === ARTICLE_PIECE)?.draft.revision;
    assert.equal(unchanged, revision, 'the document never changes while suggestions stream');
  });

  it('refuses a selection that is gone or an action with nothing to change', async () => {
    const harness = createHarness();
    const { body, revision } = await draftOf(harness);
    const base = { ...DRAFT, baseRevision: revision, body };
    const gone = await harness.service.start('article.rewrite', { ...base, target: [{ blockId: 'nope', from: 0, to: 3 }], tone: 'direct' });
    assert.equal(!gone.ok && gone.refusal.code, 'invalid_target');
    const heading = body.blocks.find((block) => block.type === 'heading');
    assert.ok(heading);
    const plain = await harness.service.start('article.rewrite', { ...base, target: [{ blockId: heading.id, from: 0, to: blockText(heading).length }], tone: 'direct' });
    assert.equal(!plain.ok && plain.refusal.code, 'no_change');
    const empty = await harness.service.start('article.ask', { ...base, prompt: '   ' });
    assert.equal(!empty.ok && empty.refusal.code, 'empty_prompt');
  });

  it('a whole-document "Encurtar para 600" proposes one suggestion per paragraph', async () => {
    const harness = createHarness({ length: 'medium' });
    const { body, revision } = await draftOf(harness);
    const total = body.blocks.reduce((sum, block) => sum + blockText(block).split(/\s+/).filter(Boolean).length, 0);
    const run = await runToEnd(harness.service, 'article.shorten', { ...DRAFT, baseRevision: revision, body, targetWords: Math.floor(total * 0.8) });
    assert.ok(run.fold.suggestions.length >= 1);
    assert.ok(run.fold.suggestions.every((suggestion) => suggestion.proposal.kind === 'replace-text' && suggestion.target.length === 1));
  });

  it('"Perguntar à IA" answers only with transcript excerpts, or says it found none', async () => {
    const harness = createHarness();
    const { body, revision } = await draftOf(harness);
    const base = { ...DRAFT, baseRevision: revision, body };
    const found = await runToEnd(harness.service, 'article.ask', { ...base, prompt: 'O que ela disse sobre a escola de panificação?' });
    const reply = found.fold.blocks.map((block) => block.text).join(' ');
    assert.match(reply, /Encontrei/);
    assert.ok(found.fold.sourcesUsed.length > 0);
    const none = await runToEnd(harness.service, 'article.ask', { ...base, prompt: 'Qual a cotação do dólar?' });
    assert.match(none.fold.blocks.map((block) => block.text).join(' '), /Não encontrei/);
    assert.equal(none.fold.suggestions.length, 0);
  });

  it('a failing suggestion scenario fails the run and creates no suggestion', async () => {
    const harness = createHarness();
    const { body, revision } = await draftOf(harness);
    const run = await runToEnd(harness.service, 'article.titles', { ...DRAFT, baseRevision: revision, body }, { simulation: 'fail-suggestion' });
    assert.equal(run.fold.run.status, 'failed');
    assert.equal(harness.record().suggestions.filter((suggestion) => suggestion.runId === run.runId).length, 0);
  });
});

describe('local generation · carousel copy', () => {
  it('needs an approved article, then writes 5 slides that fit the template from it', async () => {
    const harness = createHarness();
    await draftOf(harness);
    harness.addCarouselPiece();
    const early = await harness.service.start('carousel.copy', { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE });
    assert.equal(!early.ok && early.refusal.code, 'parent_not_ready');
    harness.approveLatestArticle();
    const run = await runToEnd(harness.service, 'carousel.copy', { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE });
    assert.deepEqual(run.fold.slides.map((slide) => slide.layout), ['cover', 'context', 'point', 'quote', 'closing']);
    assert.deepEqual(run.fold.run.steps.map((step) => step.id), ['read', 'points', 'cover', 'slides', 'limits']);
    assert.equal(run.fold.run.steps[4].meta, 'Todos os textos cabem');
    const quote = run.fold.slides[3];
    assert.ok(quote.slots.quote && quote.slots.attribution, 'quote slide carries the speaker');
    const other = await harness.service.start('carousel.copy', { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE, templateId: 'outro' });
    assert.equal(!other.ok && other.refusal.code, 'unknown_template');
  });
});

describe('local generation · review note and slide actions', () => {
  it('"Aplicar nota com IA" proposes one change per passage the reviewer pointed at', async () => {
    const harness = createHarness();
    const { body, revision } = await draftOf(harness);
    const heading = body.blocks.find((block) => block.type === 'heading');
    const paragraph = body.blocks.find((block) => block.type === 'paragraph' && blockText(block).length > 80);
    assert.ok(heading && paragraph);
    const anchors = [
      { blockId: heading.id, from: 0, to: blockText(heading).length },
      { blockId: paragraph.id, from: 0, to: 20 },
    ];
    const run = await runToEnd(harness.service, 'article.apply-note', { ...DRAFT, baseRevision: revision, body, note: 'Ajuste o intertítulo e o fim.', anchors });
    const targets = run.fold.suggestions.map((suggestion) => suggestion.target[0]?.blockId);
    assert.ok(targets.length >= 1 && targets.every((id) => id === heading.id || id === paragraph.id), 'only the pointed passages');
    assert.ok(new Set(targets).size === targets.length, 'one suggestion per passage');
    assert.ok(run.fold.suggestions.every((suggestion) => suggestion.label === 'Ajustar intertítulo' || suggestion.label === 'Ajustar trecho'));
  });

  it('slide actions run through the service and become stored slide suggestions', async () => {
    const harness = createHarness();
    await draftOf(harness);
    harness.addCarouselPiece();
    harness.approveLatestArticle();
    await runToEnd(harness.service, 'carousel.copy', { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE });
    const piece = harness.record().pieces.find((entry) => entry.id === CAROUSEL_PIECE);
    assert.ok(piece && piece.draft.body.type === 'carousel');
    const body = piece.draft.body;
    const slide = body.slides.find((entry) => entry.layout === 'point') ?? body.slides[1];
    assert.ok(slide);
    const input = { productionId: PRODUCTION_ID, pieceId: CAROUSEL_PIECE, baseRevision: piece.draft.revision, body, slideIds: [slide.id] };
    const run = await runToEnd(harness.service, 'carousel.assist', { ...input, action: 'swap' });
    assert.equal(run.fold.run.kind, 'carousel.assist');
    const proposal = run.fold.suggestions[0]?.proposal;
    assert.ok(proposal?.kind === 'slide' && proposal.slideId === slide.id && proposal.action === 'swap');
    const stored = harness.record().suggestions.find((suggestion) => suggestion.runId === run.runId);
    assert.ok(stored && stored.state === 'ready');
    assert.deepEqual(stored.anchorText, Object.keys(proposal.slots).map((slot) => slide.slots[slot] ?? ''), 'the slot texts it was made on');
    const nothing = await harness.service.start('carousel.assist', { ...input, action: 'fit' });
    assert.equal(!nothing.ok && nothing.refusal.code, 'no_change', 'every text already fits');
  });
});

describe('local generation · reload recovery', () => {
  it('orphaned runs end as "interrompida" and keep the persisted partial', async () => {
    const harness = createHarness();
    let snapshot: Parameters<typeof recoverOrphanRuns>[1] = {};
    let stopped = false;
    const run = await runToEnd(harness.service, 'article.draft', DRAFT, {}, (update, runId) => {
      if (!stopped && update.event.type === 'step.completed' && update.event.stepId === 'section-1') {
        stopped = true;
        snapshot = { [runId]: update.fold };
        void harness.service.cancel(runId);
      }
    });
    // Simulate a reload: the stored run is still "running" and only the snapshot survived.
    const stale = { ...harness.record() };
    stale.runs = stale.runs.map((entry) => (entry.id === run.runId ? { ...snapshot[run.runId].run } : entry));
    stale.versions = stale.versions.filter((version) => version.runId !== run.runId);
    const recovered = recoverOrphanRuns(stale, snapshot, { now: harness.clock.now(), newId: (prefix) => `${prefix}-r`, actorId: 'system' });
    const recoveredRun = recovered.runs.find((entry) => entry.id === run.runId);
    assert.equal(recoveredRun?.status, 'cancelled');
    const version = recovered.versions.find((entry) => entry.runId === run.runId);
    assert.ok(version?.interrupted);
    assert.ok(version.body.type === 'article' && version.body.blocks.length > 0);
  });
});
