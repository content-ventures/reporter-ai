import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DeskGroupId, DeskItem, InProgressItem } from '../../ports/production-queries.ts';
import {
  continueLine,
  continueTitle,
  deskItemLine,
  deskSummary,
  greeting,
  inProgressLine,
  inProgressSize,
  teamLine,
  weekItems,
} from './desk-copy.ts';

const NOW = new Date(2026, 9, 8, 16, 10);
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();
const person = (name: string) => ({ id: name.toLowerCase(), name, initials: name.slice(0, 1) });

function item(overrides: Partial<DeskItem> = {}): DeskItem {
  return {
    productionId: 'prod-aurora',
    productionTitle: 'Aurora Calçados: app de reposição',
    pieceId: 'piece-aurora-article',
    kind: 'article',
    pieceLabel: 'Artigo',
    status: 'in_review',
    from: person('Juliana Prates'),
    at: at(2),
    due: 'none',
    nextStep: { kind: 'review', label: 'Revisar', target: { kind: 'review', pieceKind: 'article' }, mine: true },
    ...overrides,
  } as DeskItem;
}

function groups(counts: Partial<Record<DeskGroupId, number>>) {
  return (Object.entries(counts) as [DeskGroupId, number][]).map(([id, count]) => ({ id, items: Array.from({ length: count }, () => item()) }));
}

function progress(overrides: Partial<InProgressItem> = {}): InProgressItem {
  return {
    productionId: 'prod-estudio-norte',
    productionTitle: 'Estúdio Norte: impressão 3D no protótipo',
    situation: { stage: 'article', pieceKind: 'article', status: 'draft', text: 'Rascunho', line: 'Artigo · Rascunho' },
    characters: 3_160,
    size: 'standard',
    owner: person('João'),
    updatedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    nextStep: { kind: 'continue', label: 'Continuar', target: { kind: 'studio', pieceKind: 'article' }, mine: true },
    ...overrides,
  } as InProgressItem;
}

describe('Início summary sentence', () => {
  test('greets by the local hour with the first name', () => {
    assert.equal(greeting(5, 'Pedro'), 'Bom dia, Pedro.');
    assert.equal(greeting(11, 'Pedro'), 'Bom dia, Pedro.');
    assert.equal(greeting(12, 'Juliana Prates'), 'Boa tarde, Juliana.');
    assert.equal(greeting(17, 'João'), 'Boa tarde, João.');
    assert.equal(greeting(18, 'João'), 'Boa noite, João.');
    assert.equal(greeting(4, 'João'), 'Boa noite, João.');
    assert.equal(greeting(9, undefined), 'Bom dia.');
  });

  test('lists what needs the viewer in the desk order, with "e" before the last fact', () => {
    assert.equal(deskSummary({ hour: 9, name: 'Pedro', groups: groups({ to_approve: 2 }) }), 'Bom dia, Pedro. 2 peças esperam sua aprovação.');
    assert.equal(
      deskSummary({ hour: 15, name: 'João', groups: groups({ returned: 1, failed: 1, unauthorized: 1 }) }),
      'Boa tarde, João. 1 peça voltou com ajustes, 1 artigo parou com erro e 1 material espera autorização.',
    );
    assert.equal(
      deskSummary({ hour: 20, name: 'Rafael Dias', groups: groups({ to_approve: 1, returned: 3, failed: 2, unauthorized: 4 }) }),
      'Boa noite, Rafael. 1 peça espera sua aprovação, 3 peças voltaram com ajustes, 2 artigos pararam com erro e 4 materiais esperam autorização.',
    );
  });

  test('waiting on someone else is not a fact: nothing waits for the viewer', () => {
    assert.equal(deskSummary({ hour: 15, name: 'Juliana Prates', groups: groups({ waiting_other: 1 }) }), 'Boa tarde, Juliana. Nada esperando você.');
    assert.equal(deskSummary({ hour: 8, name: 'Clara Souto', groups: [] }), 'Bom dia, Clara. Nada esperando você.');
    assert.equal(
      deskSummary({ hour: 15, name: 'Rafael Dias', groups: groups({ failed: 1, waiting_other: 1 }) }),
      'Boa tarde, Rafael. 1 artigo parou com erro.',
    );
  });
});

describe('Início rows', () => {
  test('Para aprovar: who asked, when and the recado in quotes', () => {
    const recado = 'Pedro, pode revisar hoje? O Sérgio pediu para publicar ainda nesta semana.';
    assert.equal(deskItemLine('to_approve', item({ note: recado }), NOW), `Juliana Prates · há 2 h · “${recado}”`);
    assert.equal(deskItemLine('to_approve', item(), NOW), 'Juliana Prates · há 2 h');
    assert.equal(deskItemLine('to_approve', item({ note: '  ' }), NOW), 'Juliana Prates · há 2 h');
    assert.equal(deskItemLine('to_approve', item(), undefined), 'Juliana Prates', 'no clock yet: no relative time');
  });

  test('Devolvidos para ajuste: the note is cut at 80 characters', () => {
    const note = 'O intertítulo promete mais do que a seção entrega: faltam os números do estande e a fala da Lia sobre o custo.';
    const line = deskItemLine('returned', item({ status: 'changes_requested', from: person('Pedro'), at: at(1), note }), NOW);
    assert.ok(line.startsWith('Pedro · há 1 h · “O intertítulo promete'));
    assert.ok(line.endsWith('…”'));
    assert.ok(line.length < 'Pedro · há 1 h · '.length + 84);
  });

  test('Com erro: where the AI stopped', () => {
    const failed = item({ status: 'failed', from: person('Rafael Dias'), at: new Date(NOW.getTime() - 40 * 60_000).toISOString() });
    assert.equal(deskItemLine('failed', { ...failed, progress: { current: 2, total: 4 } }, NOW), 'A IA parou na parte 2 de 4 · há 40 min');
    assert.equal(deskItemLine('failed', failed, NOW), 'A IA parou · há 40 min');
  });

  test('Material sem autorização and Aguardando outra pessoa', () => {
    assert.equal(deskItemLine('unauthorized', item({ status: 'unauthorized' }), NOW), 'Falta a autorização dos falantes');
    const waiting = item({ at: new Date(2026, 9, 8, 14, 10).toISOString(), withPerson: person('Pedro'), nextStep: null });
    assert.equal(deskItemLine('waiting_other', waiting, NOW), 'Artigo · com Pedro desde 14:10');
    assert.equal(deskItemLine('waiting_other', { ...waiting, at: new Date(2026, 9, 7, 9, 0).toISOString() }, NOW), 'Artigo · com Pedro desde ontem');
    assert.equal(deskItemLine('waiting_other', { ...waiting, withPerson: null }, NOW), 'Artigo · aguardando aprovação desde 14:10');
  });

  test('Em andamento: situation, laudas while on the article, how long ago', () => {
    assert.equal(inProgressLine(progress(), NOW), 'Artigo · Rascunho · 1,6 de 2 laudas · há 20 min');
    const writing = progress({
      situation: { stage: 'article', pieceKind: 'article', status: 'generating', text: 'A IA está escrevendo (2 de 4)', line: 'Artigo · A IA está escrevendo (2 de 4)' },
      characters: undefined,
      size: undefined,
    });
    assert.equal(inProgressLine(writing, NOW), 'Artigo · A IA está escrevendo (2 de 4) · há 20 min');
    assert.equal(inProgressSize(progress({ characters: 1_540, size: 'short' })), '0,8 de 1 lauda');
    assert.equal(inProgressSize(progress({ characters: 0 })), undefined);
  });

  test('Equipe row and the empty-queue card', () => {
    assert.equal(teamLine(progress()), 'Artigo · Rascunho · João');
    assert.equal(continueTitle(progress()), 'Continuar: Estúdio Norte: impressão 3D no protótipo');
    assert.equal(continueLine(progress()), 'Artigo · Rascunho · 1,6 de 2 laudas');
  });
});

describe('Início week line', () => {
  test('three facts for the window; missing values leave their part out', () => {
    assert.deepEqual(weekItems({ inProduction: 8, approved: 14, timeToApprovalMs: 16_212_893 }, '7d'), [
      'Esta semana: 8 em produção',
      '14 aprovadas',
      '4,5 h até aprovar',
    ]);
    assert.deepEqual(weekItems({ inProduction: 3, approved: 1, timeToApprovalMs: null }, '30d'), ['Últimos 30 dias: 3 em produção', '1 aprovada']);
    assert.deepEqual(weekItems({ inProduction: 0, approved: null, timeToApprovalMs: null }, '7d'), ['Esta semana: 0 em produção']);
  });
});
