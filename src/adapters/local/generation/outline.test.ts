import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { articleCharacters, blockText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';
import { refKey } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { pieceStatus } from '../../../domain/rules/status.ts';
import { articleBodyFromRun, outlineProposalOf } from '../../../domain/run-events.ts';
import type { OutlineProposal, RunFold } from '../../../domain/run-events.ts';
import { isPlanningRun } from '../../../domain/run.ts';
import { ARTICLE_SIZES } from '../../../domain/sizing.ts';
import type { ArticleSize } from '../../../domain/sizing.ts';
import { resolveSourceRef } from '../../../domain/source.ts';
import { runToEnd } from '../../../ports/contracts/generation.contract.ts';
import type { OutlineInput } from '../../../ports/generation.ts';
import { readMaterial } from './material.ts';
import { APPROVER, ARTICLE_PIECE, createHarness, PRODUCTION_ID } from './testing.ts';
import type { Harness } from './testing.ts';

/**
 * "Montar estrutura" → "Redigir artigo" (Nova produção, steps 3 and the studio): an outline run
 * proposes the structure without writing anything; the draft follows the structure as the person
 * left it (renamed, reordered, removed or added sections, moved quotes) and never passes the size.
 */

const PIECE = { productionId: PRODUCTION_ID, pieceId: ARTICLE_PIECE };

async function propose(harness: Harness, options: { simulation?: string } = {}): Promise<{ runId: string; fold: RunFold; proposal: OutlineProposal }> {
  const run = await runToEnd(harness.service, 'article.outline', PIECE, options);
  const proposal = outlineProposalOf(run.fold);
  assert.ok(proposal, 'the outline run proposes a structure');
  return { runId: run.runId, fold: run.fold, proposal };
}

/** The proposal as "Redigir artigo" sends it back unchanged. */
function asInput(proposal: OutlineProposal, fromRunId?: string): OutlineInput {
  const input: OutlineInput = {
    title: proposal.title,
    intro: { quotes: proposal.intro.quotes },
    sections: proposal.sections.map((section) => ({ ...(section.blockId ? { blockId: section.blockId } : {}), title: section.title, quotes: section.quotes ?? [] })),
  };
  if (fromRunId) input.fromRunId = fromRunId;
  return input;
}

async function draft(harness: Harness, outline: OutlineInput) {
  const run = await runToEnd(harness.service, 'article.draft', { ...PIECE, outline });
  return { run, body: articleBodyFromRun(run.fold) };
}

const headings = (body: ArticleBody) => body.blocks.filter((block) => block.type === 'heading').map(blockText);
const segmentOf = (ref: SourceRef) => (ref.locator.type === 'segment' ? ref.locator.segmentId : undefined);

/** The blocks under each heading (Padrão), in order. */
function sectionsOf(body: ArticleBody): { title: string; blocks: ArticleBlock[] }[] {
  const out: { title: string; blocks: ArticleBlock[] }[] = [];
  for (const block of body.blocks) {
    if (block.type === 'heading') out.push({ title: blockText(block), blocks: [] });
    else if (out.length > 0) out[out.length - 1].blocks.push(block);
  }
  return out;
}

describe('"Montar estrutura": the outline-only run', () => {
  it('reads the material and proposes the structure, writing nothing (no version, the piece stays "Não iniciado")', async () => {
    const harness = createHarness();
    const { runId, fold, proposal } = await propose(harness);
    assert.equal(fold.run.kind, 'article.outline');
    assert.ok(isPlanningRun(fold.run));
    assert.deepEqual(fold.run.steps.map((step) => [step.id, step.label]), [['read', 'Lendo material'], ['outline', 'Montando estrutura']]);
    assert.equal(fold.run.status, 'completed');
    assert.equal(fold.blocks.length, 0, 'nothing streamed');
    const record = harness.record();
    assert.equal(record.versions.length, 0, 'no version');
    const article = record.pieces.find((piece) => piece.id === ARTICLE_PIECE);
    assert.ok(article?.draft.body.type === 'article' && article.draft.body.blocks.length === 0 && article.draft.revision === 0, 'the draft is untouched');
    assert.equal(pieceStatus(record, 'article'), 'not_started');
    assert.ok(record.runs.some((run) => run.id === runId && run.kind === 'article.outline'));
    assert.equal(record.suggestions.length, 0);

    // The structure: title, introduction, sections with budgets and quotes, size, what the material gives.
    assert.ok(proposal.title.length > 0);
    assert.equal(proposal.sections.length, 3, 'the brief asks for 3 sections');
    assert.deepEqual(proposal.size, { laudas: 2, minChars: 2001, maxChars: 4000, targetChars: 3600 });
    assert.ok((proposal.materialChars ?? 0) > 0);
    assert.equal(proposal.intro.quotes.length, 1, 'the lead');
    assert.ok(proposal.intro.budget > 0);
    const sources = record.sources;
    const material = readMaterial(sources);
    const interviewer = new Set(material.lines.filter((line) => line.speaker === material.interviewer).map((line) => line.segmentId as string));
    const all = [...proposal.intro.quotes, ...proposal.sections.flatMap((section) => section.quotes ?? [])];
    assert.equal(new Set(all.map(refKey)).size, all.length, 'a quote belongs to one place only');
    for (const ref of all) {
      assert.ok(resolveSourceRef(sources, ref), 'every quote resolves in the current material');
      assert.ok(!interviewer.has(segmentOf(ref) ?? ''), 'never the interviewer');
    }
    for (const section of proposal.sections) {
      assert.ok(section.blockId && section.title.trim() && !section.title.endsWith('?'));
      assert.ok((section.budget ?? 0) > 0 && (section.quotes?.length ?? 0) > 0);
    }
    const offered = new Set(proposal.candidates.map(refKey));
    assert.ok(all.every((ref) => offered.has(refKey(ref))), 'the quotes in use are among the candidates (the screen hides them)');
    assert.ok(proposal.candidates.length >= all.length);
  });

  it('says when the material gives less than the size asks, and shrinks the budgets to what it gives', async () => {
    const harness = createHarness();
    const { fold, proposal } = await propose(harness);
    // This interview (~520 words) cannot fill 2 laudas: the structure says so and never promises more.
    assert.ok(proposal.shortfall, 'shortfall');
    assert.equal(proposal.shortfall.reason, 'material');
    assert.ok(proposal.shortfall.expectedChars <= ARTICLE_SIZES.standard.maxChars);
    const budgets = proposal.intro.budget + proposal.sections.reduce((sum, section) => sum + (section.budget ?? 0), 0);
    assert.ok(Math.abs(budgets - proposal.shortfall.expectedChars) <= proposal.sections.length + 1, `${budgets} vs ${proposal.shortfall.expectedChars}`);
    assert.match(fold.run.steps[1].meta ?? '', /^3 seções · o material rende ≈ \d+(,\d)? laudas?$/);
  });

  it('runs again on demand (a new run), and a run of an earlier session still attaches after a reload', async () => {
    const harness = createHarness();
    const first = await propose(harness);
    const second = await propose(harness);
    assert.notEqual(first.runId, second.runId);
    assert.equal(harness.record().runs.filter((run) => run.kind === 'article.outline').length, 2);
    const reloaded = harness.reload();
    const attached = await reloaded.attach(first.runId);
    assert.ok(attached.ok, 'attached from the persisted snapshot');
    assert.deepEqual(outlineProposalOf(attached.value.snapshot), first.proposal);
  });

  it('a failure leaves no version and the next attempt is a new run', async () => {
    const harness = createHarness();
    const failed = await runToEnd(harness.service, 'article.outline', PIECE, { simulation: 'fail-outline' });
    assert.equal(failed.fold.run.status, 'failed');
    assert.equal(failed.fold.run.error?.stepId, 'outline');
    assert.equal(harness.record().versions.length, 0);
    const again = await propose(harness);
    assert.equal(again.fold.run.status, 'completed');
  });

  it('a Curto proposes parts without intertítulos and a 1-lauda size', async () => {
    const harness = createHarness({ size: 'short', sections: 2 });
    const { fold, proposal } = await propose(harness);
    assert.equal(proposal.sections.length, 2);
    assert.equal(proposal.size?.maxChars, 2000);
    assert.match(fold.run.steps[1].meta ?? '', /^2 partes · (alvo 1 lauda|o material rende ≈ \d+(,\d)? laudas?)$/);
  });
});

describe('"Redigir artigo": the draft follows the reviewed structure', () => {
  it('as proposed: same titles in the same order, "Estrutura revisada", never above 2 laudas', async () => {
    const harness = createHarness();
    const { runId, proposal } = await propose(harness);
    const { run, body } = await draft(harness, asInput(proposal, runId));
    assert.equal(run.fold.run.status, 'completed');
    assert.equal(run.fold.run.steps.find((step) => step.id === 'outline')?.meta, 'Estrutura revisada');
    assert.deepEqual(run.fold.edited, { fromRunId: runId });
    assert.deepEqual(headings(body), proposal.sections.map((section) => section.title));
    assert.equal(body.title, proposal.title);
    assert.ok(harness.record().versions.some((version) => version.runId === run.runId), 'v1 · IA');
    // The draft's outline echoes the structure exactly as the person sent it.
    assert.deepEqual(
      run.fold.outline.map((section) => [section.blockId, section.title, (section.quotes ?? []).map(refKey)]),
      proposal.sections.map((section) => [section.blockId, section.title, (section.quotes ?? []).map(refKey)]),
    );
  });

  it('honours reorder, remove, add and moved quotes; each section writes only from its own quotes', async () => {
    const harness = createHarness();
    const { runId, proposal } = await propose(harness);
    const input = asInput(proposal, runId);
    const [first, second, third] = input.sections;
    // This short interview is all in use: the new section takes a line of the section that goes.
    const [fresh, ...dropped] = second.quotes;
    assert.ok(fresh);
    // Third first, the second section gone, the first renamed, a new section with a line of its own.
    const moved = first.quotes.length > 1 ? first.quotes[first.quotes.length - 1] : undefined;
    const edited: OutlineInput = {
      ...input,
      sections: [
        { ...third, quotes: moved ? [...third.quotes, moved] : third.quotes },
        { ...first, title: 'Da cozinha da mãe ao forno coletivo', quotes: moved ? first.quotes.slice(0, -1) : first.quotes },
        { title: 'A escola de panificação', quotes: [fresh] },
      ],
    };
    const { run, body } = await draft(harness, edited);
    assert.equal(run.fold.run.status, 'completed');
    assert.deepEqual(headings(body), [third.title, 'Da cozinha da mãe ao forno coletivo', 'A escola de panificação']);
    assert.deepEqual(run.fold.run.steps.filter((step) => step.id.startsWith('section-')).map((step) => step.id), ['section-1', 'section-2', 'section-3']);
    // Every block of a section cites only lines its own quotes point at.
    const written = sectionsOf(body);
    edited.sections.forEach((section, index) => {
      const own = new Set(section.quotes.map(segmentOf));
      for (const block of written[index].blocks) {
        if (block.type === 'figure') continue;
        for (const ref of block.sourceRefs ?? []) assert.ok(own.has(segmentOf(ref)), `${section.title}: ${blockText(block).slice(0, 60)}`);
      }
      assert.ok(written[index].blocks.some((block) => block.type !== 'figure'), `${section.title} has text`);
    });
    // The removed section's lines are not written (unless quoted elsewhere).
    const kept = new Set(edited.sections.flatMap((section) => section.quotes.map(segmentOf)));
    const removed = dropped.map(segmentOf).filter((segment) => !kept.has(segment));
    const cited = new Set(body.blocks.flatMap((block) => (block.sourceRefs ?? []).map(segmentOf)));
    for (const segment of removed) assert.ok(!cited.has(segment), `removed line ${segment} not written`);
    // The added section has a stable id and its quote leads it.
    const added = run.fold.outline[2];
    assert.ok(added.blockId?.startsWith('blk-out-'));
    assert.ok(written[2].blocks.some((block) => (block.sourceRefs ?? []).some((ref) => segmentOf(ref) === segmentOf(fresh))));
  });

  it('a Curto writes its parts without intertítulos, within 1 lauda', async () => {
    const harness = createHarness({ size: 'short', sections: 2 });
    const { runId, proposal } = await propose(harness);
    const { run, body } = await draft(harness, { ...asInput(proposal, runId), sections: asInput(proposal).sections.map((section) => ({ ...section, title: '' })) });
    assert.equal(run.fold.run.status, 'completed');
    assert.equal(headings(body).length, 0, 'no H2 in a Curto');
    assert.deepEqual(run.fold.outline.map((section) => section.title), ['Parte 1', 'Parte 2'], 'an empty part is "Parte k"');
    assert.ok(articleCharacters(body) > 0 && articleCharacters(body) <= ARTICLE_SIZES.short.maxChars);
    assert.ok(run.fold.blocks.every((block) => block.type !== 'heading'));
  });

  it('refuses a structure that cannot be written, in the words of Nova produção', async () => {
    const harness = createHarness();
    const { proposal } = await propose(harness);
    const input = asInput(proposal);
    const lines = proposal.candidates;
    const section = (index: number) => ({ title: `Seção ${index}`, quotes: [lines[index % lines.length]] });
    const material = readMaterial(harness.record().sources);
    const question = material.lines.find((line) => line.speaker === material.interviewer);
    assert.ok(question);
    const questionRef: SourceRef = { kind: 'source', sourceId: question.sourceId, sourceVersion: question.sourceVersion, locator: { type: 'segment', segmentId: question.segmentId } };
    const cases: [OutlineInput, string][] = [
      [{ ...input, sections: [0, 1, 2, 3, 4, 5].map(section) }, 'Padrão aceita até 5 seções.'],
      [{ ...input, sections: [input.sections[0]] }, 'Padrão precisa de pelo menos 2 seções.'],
      [{ ...input, sections: [{ ...input.sections[0], title: '  ' }, ...input.sections.slice(1)] }, 'Escreva o intertítulo.'],
      [{ ...input, sections: [{ ...input.sections[0], title: 'x'.repeat(121) }, ...input.sections.slice(1)] }, 'Intertítulo com até 120 caracteres.'],
      [{ ...input, sections: [input.sections[0], { ...input.sections[1], quotes: [...input.sections[1].quotes, input.sections[0].quotes[0]] }, input.sections[2]] }, 'Cada citação entra em uma seção só.'],
      [{ ...input, sections: [{ ...input.sections[0], quotes: [questionRef] }, ...input.sections.slice(1)] }, 'Esta citação não está na entrevista.'],
      [{ ...input, sections: [{ ...input.sections[0], quotes: [] }, ...input.sections.slice(1)] }, 'Cada seção precisa de pelo menos uma citação.'],
    ];
    const before = harness.record().runs.length;
    for (const [outline, message] of cases) {
      const started = await harness.service.start('article.draft', { ...PIECE, outline });
      assert.equal(!started.ok && started.refusal.code, 'invalid_outline', message);
      assert.equal(!started.ok && started.refusal.message, message);
    }
    assert.equal(harness.record().runs.length, before, 'nothing started');

    const curto = createHarness({ size: 'short', sections: 2 });
    const short = await propose(curto);
    const shortInput = asInput(short.proposal);
    const many = { ...shortInput, sections: [0, 1, 2, 3].map((index) => ({ title: '', quotes: [short.proposal.candidates[index]] })) };
    const none = { ...shortInput, sections: [] };
    for (const [outline, message] of [[many, 'Curto aceita até 3 partes.'], [none, 'Curto precisa de pelo menos 1 parte.']] as const) {
      const started = await curto.service.start('article.draft', { ...PIECE, outline });
      assert.equal(!started.ok && started.refusal.message, message);
    }
  });

  it('continues after a reload: a failed draft of a reviewed structure retries from its section', async () => {
    const harness = createHarness();
    const { runId, proposal } = await propose(harness);
    const input = asInput(proposal, runId);
    const failed = await runToEnd(harness.service, 'article.draft', { ...PIECE, outline: { ...input, sections: [...input.sections].reverse() } }, { simulation: 'fail-section' });
    assert.equal(failed.fold.run.status, 'failed');
    const reloaded = harness.reload();
    const attached = await reloaded.attach(failed.runId);
    assert.ok(attached.ok && attached.value.meta.canRetry === undefined, 'the structure is read back from the run: it can continue');
    const retried = await reloaded.retry(failed.runId);
    assert.ok(retried.ok, retried.ok ? '' : retried.refusal.message);
    const resumed = await reloaded.attach(retried.value.runId);
    assert.ok(resumed.ok);
    for await (const event of resumed.value.events) void event;
    const done = await reloaded.attach(retried.value.runId);
    assert.ok(done.ok && done.value.snapshot.run.status === 'completed');
    assert.deepEqual(headings(articleBodyFromRun(done.value.snapshot)), [...proposal.sections].reverse().map((section) => section.title));
  });
});

describe('the text waiting for approval is locked (D8)', () => {
  it('refuses every article and carousel generation while the piece waits, naming who has it', async () => {
    const harness = createHarness();
    await runToEnd(harness.service, 'article.draft', PIECE);
    const piece = harness.record().pieces.find((entry) => entry.id === ARTICLE_PIECE);
    assert.ok(piece && piece.draft.body.type === 'article');
    harness.requestReview({ assigneeId: APPROVER });
    const body = piece.draft.body;
    const base = { ...PIECE, baseRevision: piece.draft.revision, body };
    const attempts = [
      await harness.service.start('article.draft', PIECE),
      await harness.service.start('article.outline', PIECE),
      await harness.service.start('article.titles', base),
      await harness.service.start('article.shorten', base),
    ];
    for (const started of attempts) {
      assert.equal(!started.ok && started.refusal.code, 'locked');
      assert.equal(!started.ok && started.refusal.message, 'O texto está com Bruno para aprovação. Retire o envio para editar.');
    }
  });

  it('without a named approver it still says how to edit again', async () => {
    const harness = createHarness();
    await runToEnd(harness.service, 'article.draft', PIECE);
    harness.requestReview();
    const started = await harness.service.start('article.draft', PIECE);
    assert.equal(!started.ok && started.refusal.message, 'O texto está aguardando aprovação. Retire o envio para editar.');
  });
});

describe('sizes of a reviewed structure', () => {
  for (const size of ['short', 'standard'] as ArticleSize[]) {
    it(`${size}: never above the maximum, whatever the edit`, async () => {
      const spec = ARTICLE_SIZES[size];
      const harness = createHarness({ size, sections: spec.sections.default });
      const { runId, proposal } = await propose(harness);
      // Every line of the interview in the structure: the most it can give, still never above the size.
      const input = asInput(proposal, runId);
      const used = new Set([...input.intro?.quotes ?? [], ...input.sections.flatMap((section) => section.quotes)].map(refKey));
      const rest = proposal.candidates.filter((ref) => !used.has(refKey(ref)));
      const greedy = { ...input, sections: input.sections.map((section, index) => ({ ...section, quotes: [...section.quotes, ...rest.filter((_, at) => at % input.sections.length === index)] })) };
      const { run, body } = await draft(harness, greedy);
      assert.equal(run.fold.run.status, 'completed');
      assert.ok(articleCharacters(body) > 0);
      assert.ok(articleCharacters(body) <= spec.maxChars, `${articleCharacters(body)} > ${spec.maxChars}`);
    });
  }
});
