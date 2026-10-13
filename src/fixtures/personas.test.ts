import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { createLocalPorts, manualClock, sequentialIds } from '../adapters/local/store/index.ts';
import type { LocalPorts } from '../adapters/local/store/index.ts';
import type { DeskGroupId, ProductionListItem } from '../ports/production-queries.ts';
import { createFixtures, fixtureSeed, PEOPLE } from './index.ts';

/**
 * CONTRACT §5: what each persona finds on Início, in Aprovações and in Produções with the seeded
 * workspace (assignees, due dates, the 2º envio of Aurora, the outdated approval of Pátio Couro).
 */

const NOW = '2026-10-08T15:00:00.000Z';

let ports: LocalPorts;

before(() => {
  const fixtures = createFixtures({ now: NOW });
  ports = createLocalPorts({ seed: () => fixtureSeed(fixtures), clock: manualClock(NOW), ids: sequentialIds(), templates: fixtures.templates, scheduler: () => () => undefined });
});

async function as(personId: string): Promise<void> {
  const acted = await ports.session.actAs?.(personId);
  assert.ok(acted?.ok, `act as ${personId}`);
}

const head = (title: string) => title.split(':')[0];

async function groups(): Promise<Partial<Record<DeskGroupId, string[]>>> {
  const { desk } = await ports.queries.overview('7d');
  return Object.fromEntries(desk.groups.map((group) => [group.id, group.items.map((item) => `${head(item.productionTitle)}${item.pieceLabel ? ` · ${item.pieceLabel}` : ''}`)]));
}

async function listed(): Promise<Map<string, ProductionListItem>> {
  const page = await ports.queries.list({ sort: 'urgency' }, { size: 50 });
  return new Map(page.items.map((item) => [head(item.title), item]));
}

describe('personas on the seeded workspace (CONTRACT §5)', () => {
  test('Pedro: "Para aprovar" holds Lume (atrasado) and Aurora (prazo hoje); Início, Aprovações and the menu agree', async () => {
    await as(PEOPLE.pedro);
    assert.deepEqual(await groups(), { to_approve: ['Lume Acessórios · Carrossel', 'Aurora Calçados · Artigo'] });
    const { desk } = await ports.queries.overview('7d');
    const [lume, aurora] = desk.groups[0].items;
    assert.deepEqual([lume.due, aurora.due], ['overdue', 'today']);
    assert.equal(aurora.note, 'Pedro, pode revisar hoje? O Sérgio pediu para publicar ainda nesta semana.');
    assert.equal(lume.note, undefined);
    const queue = await ports.queries.approvals('to_approve');
    assert.equal(queue.counts.to_approve, 2);
    assert.equal(desk.needsYou, queue.counts.to_approve);
    assert.deepEqual(
      queue.items.map((item) => [head(item.productionTitle), item.round]),
      [
        ['Lume Acessórios', 1],
        ['Aurora Calçados', 2],
      ],
    );
    const returned = await ports.queries.approvals('returned');
    assert.deepEqual(
      returned.items.map((item) => [head(item.productionTitle), item.round]),
      [
        ['Casa Forma', 1],
        ['Aurora Calçados', 1],
      ],
    );
    const approved = await ports.queries.approvals('approved_by_me');
    for (const title of ['Pátio Couro', 'Lume Acessórios', 'Bella Passo']) {
      assert.ok(approved.items.some((item) => head(item.productionTitle) === title && item.kind === 'article'), title);
    }
  });

  test('Pedro reviews Aurora on "O que mudou", 2º envio, due today, with Lume next', async () => {
    await as(PEOPLE.pedro);
    const aurora = (await listed()).get('Aurora Calçados');
    assert.ok(aurora);
    const detail = await ports.queries.get(aurora.id);
    assert.ok(detail.ok);
    const pieceId = detail.value.approvals.article?.pieceId;
    assert.ok(pieceId);
    const review = await ports.queries.review(pieceId);
    assert.ok(review.ok);
    assert.equal(review.value.defaultView, 'changes');
    assert.equal(review.value.previous?.decision, 'changes_requested');
    assert.deepEqual(
      { round: review.value.approval.request?.round, due: review.value.approval.request?.due, canDecide: review.value.approval.viewer.canDecide, isAssignee: review.value.approval.viewer.isAssignee },
      { round: 2, due: 'today', canDecide: true, isAssignee: true },
    );
    assert.equal(head(review.value.nextInQueue?.productionTitle ?? ''), 'Lume Acessórios');
  });

  test('João: Devolvidos (Casa Forma) · Com erro (Grupo Horizonte) · Material sem autorização (Couro Nobre)', async () => {
    await as(PEOPLE.joao);
    assert.deepEqual(await groups(), {
      returned: ['Casa Forma · Artigo'],
      failed: ['Grupo Horizonte · Artigo'],
      unauthorized: ['Painel Couro Nobre'],
    });
    const { desk } = await ports.queries.overview('7d');
    assert.equal(desk.needsYou, 3);
    assert.equal(desk.groups.find((group) => group.id === 'failed')?.items[0].progress?.total, 3);
    assert.equal((await ports.queries.approvals('to_approve')).counts.to_approve, 0, 'Aurora and Lume are with Pedro');
    assert.deepEqual(
      desk.inProgress.map((item) => head(item.productionTitle)),
      ['Estúdio Norte'],
    );
    assert.equal(head(desk.continueWith?.productionTitle ?? ''), 'Estúdio Norte');
  });

  test('Juliana waits for Pedro on Aurora; Rafael has Horizonte to retry and waits on the Lume carousel', async () => {
    await as(PEOPLE.juliana);
    assert.deepEqual(await groups(), { waiting_other: ['Aurora Calçados · Artigo'] });
    const juliana = (await ports.queries.overview('7d')).desk;
    assert.equal(juliana.needsYou, 0);
    assert.equal(juliana.groups[0].items[0].withPerson?.id, PEOPLE.pedro);
    assert.equal(juliana.groups[0].items[0].nextStep, null);

    await as(PEOPLE.rafael);
    assert.deepEqual(await groups(), { failed: ['Grupo Horizonte · Artigo'], waiting_other: ['Lume Acessórios · Carrossel'] });
  });

  test('every production reads its "Situação" in one line, most urgent first', async () => {
    await as(PEOPLE.joao);
    const items = await listed();
    const lines = Object.fromEntries([...items].map(([title, item]) => [title, item.situation.line]));
    assert.match(lines['Entrevista Ateliê Sul'], /^Artigo · A IA está escrevendo \(\d de \d\)$/);
    assert.deepEqual(
      { ...lines, 'Entrevista Ateliê Sul': 'writing' },
      {
        'Grupo Horizonte': 'Artigo · Erro',
        'Casa Forma': 'Artigo · Ajustes solicitados por Pedro',
        'Aurora Calçados': 'Artigo · Aguardando aprovação de Pedro',
        'Lume Acessórios': 'Carrossel · Aguardando aprovação de Pedro',
        'Painel Couro Nobre': 'Material · Falta autorização',
        'Pátio Couro': 'Artigo · Aprovação desatualizada',
        'Entrevista Ateliê Sul': 'writing',
        'Estúdio Norte': 'Artigo · Rascunho',
        'Bella Passo': 'Entrega · Concluída',
      },
    );
    assert.deepEqual([...items.keys()].slice(0, 2), ['Grupo Horizonte', 'Casa Forma'], 'what stopped or came back first');
  });

  test('Estúdio Norte: "Falta para enviar: 1 sugestão · 1 citação" and the AI text still not reviewed', async () => {
    await as(PEOPLE.joao);
    const norte = (await listed()).get('Estúdio Norte');
    assert.ok(norte);
    const detail = await ports.queries.get(norte.id);
    assert.ok(detail.ok);
    const items = detail.value.approvals.article?.send.items ?? [];
    assert.deepEqual(
      items.filter((item) => item.short).map((item) => item.short),
      ['1 sugestão', '1 citação'],
    );
    assert.ok(items.some((item) => item.id === 'text-review' && item.level === 'missing' && item.text === 'Texto não revisado'));
    assert.ok(items.some((item) => item.id === 'images' && item.text === '2 imagens sugeridas sem arquivo'));
    assert.equal(detail.value.approvals.article?.send.guard.allowed, true, 'the button opens the dialog');
  });

  test('Pátio Couro: the approval is outdated, the carousel and the delivery keep v3', async () => {
    await as(PEOPLE.juliana);
    const patio = (await listed()).get('Pátio Couro');
    assert.ok(patio);
    const detail = await ports.queries.get(patio.id);
    assert.ok(detail.ok);
    const approval = detail.value.approvals.article;
    assert.equal(approval?.state, 'approval_outdated');
    assert.equal(approval?.approvedVersion?.number, 3);
    assert.equal(detail.value.pieces.find((piece) => piece.kind === 'carousel')?.status, 'stale');
    assert.deepEqual(detail.value.nextStep && [detail.value.nextStep.kind, detail.value.nextStep.mine], ['resend', true]);
  });
});
