import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StageView } from '../../domain/index.ts';
import type { PieceApproval } from '../../ports/index.ts';
import { decidesAt, journeyLabel, journeyMenuItems, stageDescription, stageNavigable, stageReason, viewedStageIndex } from './journey.ts';

/** Aurora: the article was sent to Pedro; the carousel and the delivery wait for its approval. */
const STAGES: StageView[] = [
  { id: 'source', label: 'Material', kind: 'source', state: 'done', status: 'ready', selectable: true },
  { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article', state: 'done', status: 'in_review', selectable: true },
  {
    id: 'approval',
    label: 'Aprovação',
    kind: 'gate',
    pieceKind: 'article',
    state: 'current',
    status: 'in_review',
    detail: 'Com Pedro',
    selectable: true,
  },
  {
    id: 'carousel',
    label: 'Carrossel',
    kind: 'piece',
    pieceKind: 'carousel',
    state: 'blocked',
    status: 'locked',
    blockedReason: 'Disponível após aprovar o artigo.',
    selectable: false,
  },
  {
    id: 'delivery',
    label: 'Entrega',
    kind: 'delivery',
    state: 'blocked',
    status: 'waiting',
    blockedReason: 'Disponível após aprovar o artigo e o carrossel.',
    selectable: false,
  },
];

function approval(state: PieceApproval['state'], canDecide: boolean): PieceApproval {
  return {
    pieceId: 'piece-1',
    kind: 'article',
    gateId: 'article.approval',
    state,
    requests: [],
    decisions: [],
    locked: state === 'awaiting',
    send: { guard: { allowed: true }, items: [], approvers: [], isResend: false },
    viewer: { canEdit: true, canSend: true, canDecide, canWithdraw: false, isRequester: false, isAssignee: canDecide },
  } as unknown as PieceApproval;
}

describe('journey menu (D3, COPY §5.3)', () => {
  it('the trigger names the stage on screen and its place: "Artigo · 2 de 5", "Aprovação · 3 de 5"', () => {
    assert.equal(journeyLabel(STAGES, 1), 'Artigo · 2 de 5');
    assert.equal(journeyLabel(STAGES, 2), 'Aprovação · 3 de 5');
    assert.equal(journeyLabel(STAGES.filter((stage) => stage.kind !== 'gate'), 3), 'Entrega · 4 de 4', 'a flow without the approval stage has 4');
    assert.equal(journeyLabel([], 0), '');
  });

  it('the stage on screen: the route’s, else the journey’s current one', () => {
    assert.equal(viewedStageIndex(STAGES, 'article', 'approval'), 1);
    assert.equal(viewedStageIndex(STAGES, undefined, 'approval'), 2);
    assert.equal(viewedStageIndex(STAGES, 'missing', 'approval'), 2);
    assert.equal(viewedStageIndex(STAGES, undefined, 'missing'), 0);
  });

  it('each stage says where it stands: done, the approval detail, blocked reasons without the final period', () => {
    const items = journeyMenuItems(STAGES, 1);
    assert.deepEqual(
      items.map((item) => [item.label, item.description, item.disabled, item.checked]),
      [
        ['Material', 'Concluída', false, false],
        ['Artigo', 'Concluída', false, true],
        ['Aprovação', 'Com Pedro', false, false],
        ['Carrossel', 'Disponível após aprovar o artigo', true, false],
        ['Entrega', 'Disponível após aprovar o artigo e o carrossel', true, false],
      ],
    );
  });

  it('current stage without detail is "Em andamento"; a stage ahead says nothing; a delivered production is "Concluída"', () => {
    const writing: StageView = { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article', state: 'current', status: 'generating', selectable: true };
    const ahead: StageView = { id: 'approval', label: 'Aprovação', kind: 'gate', pieceKind: 'article', state: 'upcoming', status: 'draft', selectable: true };
    assert.equal(stageDescription(writing), 'Em andamento');
    assert.equal(stageDescription(ahead), undefined);
    const delivery: StageView = { id: 'delivery', label: 'Entrega', kind: 'delivery', state: 'current', status: 'completed', selectable: true };
    assert.equal(stageDescription(delivery, true), 'Concluída');
  });

  it('a flagged stage says its piece status; the approval detail wins over the flag', () => {
    const stale: StageView = { id: 'carousel', label: 'Carrossel', kind: 'piece', pieceKind: 'carousel', state: 'warn', status: 'stale', selectable: true };
    assert.ok(stageDescription(stale), 'the carousel says it is outdated');
    const outdated: StageView = { ...stale, id: 'approval', kind: 'gate', pieceKind: 'article', status: 'approval_outdated', detail: 'Aprovação desatualizada' };
    assert.equal(stageDescription(outdated), 'Aprovação desatualizada');
  });

  it('blocked stages do not navigate; their reason drops the final period', () => {
    assert.equal(stageNavigable(STAGES[3] as StageView), false);
    assert.equal(stageNavigable(STAGES[0] as StageView), true);
    assert.equal(stageReason({ state: 'done', blockedReason: 'x.' }), undefined);
  });

  it('the approval opens the review only for whoever decides there, once something was sent', () => {
    assert.equal(decidesAt({ article: approval('awaiting', true) }, 'article'), true);
    assert.equal(decidesAt({ article: approval('approved', true) }, 'article'), true);
    assert.equal(decidesAt({ article: approval('awaiting', false) }, 'article'), false, 'the sender waits in the studio');
    assert.equal(decidesAt({ article: approval('none', true) }, 'article'), false, 'nothing sent yet: the studio');
    assert.equal(decidesAt({}, 'article'), false);
    assert.equal(decidesAt(undefined, undefined), false);
  });
});
