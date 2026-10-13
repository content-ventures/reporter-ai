import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductionRecord } from './record.ts';
import type { RunStep } from './run.ts';
import { NEXT_STEP_LABELS, nextStepFor, situationOf, writingParts } from './situation.ts';
import { pieceStatus } from './rules/status.ts';
import type { ArticleBody } from './article.ts';
import type { Version } from './piece.ts';
import { R1_FLOW, stageState } from './stage.ts';
import { approvedPackage, baseRecord, commitVersion, createKit, JOAO, MEMBERS, PEDRO, recordDecision, requestReview, sampleArticle } from './testing/scenario.ts';
import type { TestKit } from './testing/scenario.ts';
import { buildProductionView } from './views.ts';

const NAMES: Record<string, string> = { [PEDRO]: 'Pedro', 'person-joao': 'João' };
const nameOf = (id: string) => NAMES[id] ?? id;

function lineOf(record: ProductionRecord, now: string): string {
  return buildProductionView(record, { now, nameOf }).situation.line;
}

function assign(record: ProductionRecord, assigneeId: string): void {
  record.reviewRequests = record.reviewRequests.map((request) => ({ ...request, assigneeId }));
}

/** A newer approved article: the approved carousel made from the older one falls behind. */
function reapproveArticle(record: ProductionRecord, kit: TestKit, article: Version): void {
  const v2 = commitVersion(record, kit, 'article', { ...(article.body as ArticleBody), title: 'Revisto' });
  recordDecision(record, kit, v2, 'approved');
}

describe('writingParts', () => {
  const step = (id: string, state: RunStep['state']): RunStep => ({ id, label: id, state });

  it('counts the introduction and the sections, and points at the first part not written', () => {
    const steps = [step('read', 'done'), step('outline', 'done'), step('intro', 'done'), step('section-1', 'error'), step('section-2', 'upcoming'), step('section-3', 'upcoming'), step('quotes', 'upcoming')];
    assert.deepEqual(writingParts({ steps }), { current: 2, total: 4 });
    assert.deepEqual(writingParts({ steps: steps.map((entry) => ({ ...entry, state: 'done' as const })) }), { current: 4, total: 4 });
    assert.equal(writingParts({ steps: [step('read', 'current')] }), undefined);
  });
});

describe('situationOf', () => {
  it('says where the production stands in one newsroom line', () => {
    const kit = createKit();
    const unauthorized = baseRecord(kit, { authorized: false });
    assert.equal(lineOf(unauthorized, kit.now()), 'Material · Falta autorização');

    const record = baseRecord(kit, { plan: ['article'] });
    assert.equal(lineOf(record, kit.now()), 'Artigo · Não iniciado');
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    assert.equal(lineOf(record, kit.now()), 'Artigo · Rascunho');
    requestReview(record, kit, v1);
    assert.equal(lineOf(record, kit.now()), 'Artigo · Aguardando aprovação');
    assign(record, PEDRO);
    const awaiting = buildProductionView(record, { now: kit.now(), nameOf }).situation;
    assert.equal(awaiting.line, 'Artigo · Aguardando aprovação de Pedro');
    assert.equal(awaiting.stage, 'approval');
    assert.equal(awaiting.withPersonId, PEDRO);
    recordDecision(record, kit, v1, 'changes_requested', { note: 'Rever o título.' });
    assert.equal(lineOf(record, kit.now()), 'Artigo · Ajustes solicitados por Pedro');
    recordDecision(record, kit, v1, 'approved');
    assert.equal(lineOf(record, kit.now()), 'Entrega · Pronto para baixar');
  });

  it('reads the parent after its approval while the derivative is not created yet', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    recordDecision(record, kit, v1, 'approved');
    const view = buildProductionView(record, { now: kit.now(), nameOf });
    assert.equal(view.situation.line, 'Artigo · Aprovado');
    assert.equal(situationOf({ record, view, nameOf, now: kit.now() }).stage, 'carousel');
  });
});

describe('stageState: the five-step journey (D3)', () => {
  it('completes Artigo on send and keeps Aprovação current with "Com Pedro" until the decision', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    const draft = stageState(record, R1_FLOW, { nameOf });
    assert.deepEqual(draft.stages.map((stage) => stage.id), ['source', 'article', 'approval', 'carousel', 'delivery']);
    assert.equal(draft.currentStageId, 'article');
    assert.equal(draft.stages[2].state, 'upcoming');

    requestReview(record, kit, v1);
    assign(record, PEDRO);
    const awaiting = stageState(record, R1_FLOW, { nameOf });
    assert.equal(awaiting.currentStageId, 'approval');
    assert.equal(awaiting.stages[1].state, 'done');
    assert.equal(awaiting.stages[2].detail, 'Com Pedro');

    recordDecision(record, kit, v1, 'changes_requested', { note: 'Rever.' });
    const returned = stageState(record, R1_FLOW, { nameOf });
    assert.equal(returned.currentStageId, 'article');
    assert.equal(returned.stages[2].detail, 'Ajustes solicitados');
    assert.equal(returned.stages[2].state, 'warn');

    recordDecision(record, kit, v1, 'approved');
    const approved = stageState(record, R1_FLOW, { nameOf });
    assert.equal(approved.currentStageId, 'carousel');
    assert.equal(approved.stages[2].state, 'done');
    assert.equal(approved.stages[2].detail, 'Aprovado');
  });
});

describe('NEXT_STEP_LABELS', () => {
  it('are the verbs of the copy deck', () => {
    assert.equal(NEXT_STEP_LABELS.review, 'Revisar');
    assert.equal(NEXT_STEP_LABELS.create_carousel, 'Criar carrossel');
    assert.equal(NEXT_STEP_LABELS.deliver, 'Baixar pacote');
  });
});

describe('nextStepFor (the viewer rules, CONTRACT §2.2)', () => {
  const ANA = MEMBERS.editorOnly;
  const steps = (record: ProductionRecord, now: string) =>
    Object.fromEntries(
      (
        [
          ['João', MEMBERS[JOAO]],
          ['Pedro', MEMBERS[PEDRO]],
          ['Ana', ANA],
        ] as const
      ).map(([name, viewer]) => {
        const view = buildProductionView(record, { now, nameOf });
        const step = nextStepFor({ record, view, viewer, nameOf, now });
        return [name, step ? `${step.label}${step.mine ? '' : ' ·'}` : null];
      }),
    );

  it('walks an article from structure to approval for the owner, the approver and another editor', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    assert.deepEqual(steps(record, kit.now()), { João: 'Montar estrutura', Pedro: 'Abrir ·', Ana: 'Montar estrutura ·' });
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    assert.deepEqual(steps(record, kit.now()), { João: 'Continuar', Pedro: 'Abrir ·', Ana: 'Continuar ·' });
    requestReview(record, kit, v1);
    assert.deepEqual(steps(record, kit.now()), { João: null, Pedro: 'Revisar', Ana: 'Abrir ·' }, 'the sender waits; any approver reviews an unassigned send');
    assign(record, 'person-other-approver');
    assert.deepEqual(steps(record, kit.now()), { João: null, Pedro: 'Revisar ·', Ana: 'Abrir ·' }, 'assigned to someone else: not in Pedro\'s queue');
    recordDecision(record, kit, v1, 'changes_requested', { note: 'Rever o título.' });
    assert.deepEqual(steps(record, kit.now()), { João: 'Ajustar', Pedro: 'Abrir ·', Ana: 'Ajustar ·' });
    const v2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Título novo' });
    requestReview(record, kit, v2);
    recordDecision(record, kit, v2, 'approved');
    assert.deepEqual(steps(record, kit.now()), { João: 'Baixar pacote', Pedro: 'Abrir ·', Ana: 'Baixar pacote ·' });
    record.pieces = record.pieces.map((piece) => (piece.draft.body.type === 'article' ? { ...piece, draft: { ...piece.draft, body: { ...piece.draft.body, title: 'Mexido depois' } } } : piece));
    assert.equal(lineOf(record, kit.now()), 'Artigo · Aprovação desatualizada');
    assert.deepEqual(steps(record, kit.now()), { João: 'Reenviar', Pedro: 'Abrir ·', Ana: 'Reenviar ·' });
  });

  it('carousel: "Criar carrossel" after the article approval, then "Atualizar carrossel" when it falls behind', () => {
    const kit = createKit();
    const { record, article } = approvedPackage(kit);
    reapproveArticle(record, kit, article);
    assert.deepEqual(steps(record, kit.now()), { João: 'Atualizar carrossel', Pedro: 'Abrir ·', Ana: 'Atualizar carrossel ·' });
    const fresh = baseRecord(createKit());
    const kit2 = createKit();
    const a1 = commitVersion(fresh, kit2, 'article', sampleArticle(fresh.sources[0]), { origin: 'generation' });
    recordDecision(fresh, kit2, a1, 'approved');
    assert.deepEqual(steps(fresh, kit2.now()), { João: 'Criar carrossel', Pedro: 'Abrir ·', Ana: 'Criar carrossel ·' });
  });

  it('the owner and admins retry a failed generation and authorise the material', () => {
    const kit = createKit();
    const unauthorized = baseRecord(kit, { authorized: false });
    assert.deepEqual(steps(unauthorized, kit.now()), { João: 'Autorizar', Pedro: 'Abrir ·', Ana: 'Abrir ·' });
    const record = baseRecord(kit);
    record.runs = [
      {
        id: 'run-1',
        kind: 'article.generate',
        productionId: record.production.id,
        pieceId: record.pieces[0].id,
        prompt: { key: 'k', version: '1', hash: 'h' },
        model: { alias: 'local-simulation', label: 'Simulação local', engine: 'simulated' },
        inputs: [],
        status: 'failed',
        steps: [],
        error: { code: 'x', message: 'Falhou', retryable: true },
        createdBy: JOAO,
        createdAt: kit.now(),
      },
    ];
    assert.deepEqual(steps(record, kit.now()), { João: 'Tentar de novo', Pedro: 'Abrir ·', Ana: 'Abrir ·' });
  });
});

describe('pieceStatus precedence with approval_outdated', () => {
  it('a later "Pedir ajustes" or a stale parent wins over an outdated approval; a send waits above all', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    recordDecision(record, kit, v1, 'approved');
    const v2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Outro título' });
    assert.equal(pieceStatus(record, 'article'), 'approval_outdated', 'edited (and even saved as a version) after the approval');
    requestReview(record, kit, v2);
    assert.equal(pieceStatus(record, 'article'), 'in_review');
    recordDecision(record, kit, v2, 'changes_requested', { note: 'Volte ao título aprovado.' });
    assert.equal(pieceStatus(record, 'article'), 'changes_requested');
  });
});
