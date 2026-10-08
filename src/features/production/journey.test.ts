import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StageView } from '../../domain/index.ts';
import { journeySteps, stageMenuItems, stageNavigable, stageReason, stepperCurrent } from './journey.ts';

const STAGES: StageView[] = [
  { id: 'source', label: 'Material', kind: 'source', state: 'done', status: 'ready', selectable: true },
  { id: 'article', label: 'Artigo', kind: 'piece', pieceKind: 'article', state: 'current', status: 'draft', selectable: true },
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

describe('journey header (B04)', () => {
  it('on the journey stage: it is the current one, the rest keep their state and reason', () => {
    const steps = journeySteps(STAGES, 1);
    assert.deepEqual(
      steps.map((step) => step.state),
      ['done', undefined, 'blocked', 'blocked'],
    );
    assert.equal(steps[2]?.reason, 'Disponível após aprovar o artigo');
    assert.equal(steps[1]?.reason, undefined);
  });

  it('viewing another stage: the journey stage stays "em andamento", never "a seguir"', () => {
    const steps = journeySteps(STAGES, 0);
    assert.equal(steps[0]?.state, undefined);
    assert.equal(steps[1]?.state, 'active');
  });

  it('a blocked stage reached by its address reads as blocked, with its reason, and no stage is "here"', () => {
    const steps = journeySteps(STAGES, 3);
    assert.equal(steps[3]?.state, 'blocked');
    assert.equal(steps[3]?.reason, 'Disponível após aprovar o artigo e o carrossel');
    assert.equal(steps[1]?.state, 'active', 'the journey is still on the article');
    assert.equal(stepperCurrent(STAGES, 3), -1);
    assert.equal(stepperCurrent(STAGES, 1), 1);
  });

  it('a delivered production has no open work: its last stage reads as done', () => {
    const delivered = STAGES.map((stage, index) => ({ ...stage, state: index === 3 ? ('current' as const) : ('done' as const) }));
    assert.equal(journeySteps(delivered, 1, true)[3]?.state, 'done');
  });

  it('blocked stages do not navigate; their reason drops the final period', () => {
    assert.equal(stageNavigable(STAGES[2] as StageView), false);
    assert.equal(stageNavigable(STAGES[0] as StageView), true);
    assert.equal(stageReason({ state: 'done', blockedReason: 'x.' }), undefined);
  });

  it('phone menu: state or reason per stage, the one on screen checked, blocked ones disabled', () => {
    const items = stageMenuItems(STAGES, 0);
    assert.deepEqual(
      items.map((item) => [item.label, item.description, item.disabled, item.checked]),
      [
        ['Material', 'Concluída', false, true],
        ['Artigo', 'Em andamento', false, false],
        ['Carrossel', 'Disponível após aprovar o artigo', true, false],
        ['Entrega', 'Disponível após aprovar o artigo e o carrossel', true, false],
      ],
    );
  });
});
