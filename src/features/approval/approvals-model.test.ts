import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatLaudasOf } from '../../domain/index.ts';
import type { ApprovalItem } from '../../ports/index.ts';
import {
  APPROVALS_EMPTY,
  APPROVALS_TABS,
  decidedLine,
  dueOf,
  itemKey,
  noteLine,
  phoneDescription,
  pieceMeta,
  senderLine,
} from './approvals-model.ts';

const now = new Date('2026-10-08T14:00:00');

function item(partial: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    productionId: 'prod-aurora',
    productionTitle: 'Aurora',
    pieceId: 'piece-aurora-article',
    kind: 'article',
    pieceLabel: 'Artigo',
    requester: { id: 'person-juliana', name: 'Juliana Prates' },
    requestedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    due: 'none',
    round: 1,
    characters: 2400,
    size: 'standard',
    ...partial,
  } as ApprovalItem;
}

describe('tabs', () => {
  it('lists the three tabs in order, each with an empty state', () => {
    assert.deepEqual(
      APPROVALS_TABS.map((tab) => [tab.value, tab.label]),
      [
        ['to_approve', 'Para aprovar'],
        ['approved_by_me', 'Aprovadas por mim'],
        ['returned', 'Devolvidas'],
      ],
    );
    for (const tab of APPROVALS_TABS) assert.ok(APPROVALS_EMPTY[tab.value].title.length > 0);
  });
});

describe('the line under the piece', () => {
  it('says the piece, its size and the round only while it waits', () => {
    const second = item({ round: 2 });
    assert.equal(pieceMeta(second, { round: true }), `Artigo · ${formatLaudasOf(2400, 'standard')} · 2º envio`);
    assert.equal(pieceMeta(second), `Artigo · ${formatLaudasOf(2400, 'standard')}`);
    assert.equal(pieceMeta(item()), `Artigo · ${formatLaudasOf(2400, 'standard')}`);
  });

  it('counts the slides of a carousel', () => {
    assert.equal(pieceMeta(item({ kind: 'carousel', pieceLabel: 'Carrossel', slides: 5 })), 'Carrossel · 5 slides');
    assert.equal(pieceMeta(item({ kind: 'carousel', pieceLabel: 'Carrossel', slides: 1 })), 'Carrossel · 1 slide');
  });
});

describe('who sent it and when', () => {
  it('reads the first name and how long ago', () => {
    assert.equal(senderLine(item(), now), 'Juliana · há 2 h');
    assert.equal(senderLine(item({ requester: null }), now), 'Alguém · há 2 h');
    assert.equal(senderLine(item(), undefined), 'Juliana');
  });

  it('reads when the viewer decided', () => {
    assert.equal(decidedLine({ decidedAt: undefined }, now), undefined);
    assert.match(decidedLine({ decidedAt: new Date('2026-10-08T09:30:00').toISOString() }, now) ?? '', /^08\/10, 09:30$/);
  });
});

describe('due date', () => {
  it('uses the NextAction tones: today, overdue, later', () => {
    assert.deepEqual(dueOf('2026-10-08', now), { text: 'prazo: hoje', tone: 'today' });
    assert.equal(dueOf('2026-10-07', now)?.tone, 'overdue');
    assert.match(dueOf('2026-10-07', now)?.text ?? '', /^atrasado · prazo era 07\/10$/);
    assert.deepEqual(dueOf('2026-10-10', now), { text: 'prazo: 10/10', tone: 'later' });
  });

  it('says nothing without a date', () => {
    assert.equal(dueOf(undefined, now), undefined);
    assert.equal(dueOf('2026-10-08', undefined), undefined);
  });
});

describe('the recado', () => {
  it('quotes it, cut on a word, and says nothing without one', () => {
    assert.equal(noteLine('Pedro, pode revisar hoje?'), '“Pedro, pode revisar hoje?”');
    assert.equal(noteLine('   '), undefined);
    assert.equal(noteLine(undefined), undefined);
    const long = noteLine('palavra '.repeat(30), 20);
    assert.ok(long?.startsWith('“palavra') && long.endsWith('…”'));
  });
});

describe('phone row and keys', () => {
  it('joins the piece, the sender and the recado on one line', () => {
    assert.equal(
      phoneDescription(item({ round: 2, note: 'Pode revisar hoje?' }), 'to_approve', now),
      `Artigo · ${formatLaudasOf(2400, 'standard')} · 2º envio · Juliana · há 2 h · “Pode revisar hoje?”`,
    );
  });

  it('shows the decision note on the returned tab', () => {
    const returned = item({ decision: 'changes_requested', decidedAt: new Date('2026-10-08T09:30:00').toISOString(), decisionNote: 'Encurte a abertura.' });
    assert.equal(phoneDescription(returned, 'returned', now), `Artigo · ${formatLaudasOf(2400, 'standard')} · 08/10, 09:30 · “Encurte a abertura.”`);
  });

  it('keys a row by its piece', () => {
    assert.equal(itemKey(item()), 'piece-aurora-article');
  });
});
