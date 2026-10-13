import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewNextStep } from './review-next-step.ts';

const article = { kind: 'article' as const, decision: 'approved' as const, canEdit: true,
  plannedCarousel: true, hasNextInQueue: false };

test('article approval continues to the planned carousel even before its piece exists', () => {
  assert.deepEqual(reviewNextStep(article), { kind: 'carousel', label: 'Criar carrossel' });
  assert.deepEqual(reviewNextStep({ ...article, carouselStatus: 'not_started' }), { kind: 'carousel', label: 'Criar carrossel' });
  assert.deepEqual(reviewNextStep({ ...article, carouselStatus: 'draft' }), { kind: 'carousel', label: 'Abrir o carrossel' });
});

test('article-only productions and approved carousels continue to delivery', () => {
  const expected = { kind: 'delivery', label: 'Ir para entrega' };
  assert.deepEqual(reviewNextStep({ ...article, plannedCarousel: false }), expected);
  assert.deepEqual(reviewNextStep({ ...article, carouselStatus: 'approved' }), expected);
  assert.deepEqual(reviewNextStep({ ...article, kind: 'carousel' }), expected);
});

test('review-only roles continue their queue, never land on a forbidden creation step', () => {
  assert.deepEqual(reviewNextStep({ ...article, canEdit: false }), { kind: 'approvals', label: 'Voltar às aprovações' });
  assert.deepEqual(reviewNextStep({ ...article, canEdit: false, hasNextInQueue: true }), { kind: 'next_review', label: 'Revisar próxima produção' });
  assert.deepEqual(reviewNextStep({ ...article, canEdit: false, decision: 'changes_requested' }), { kind: 'approvals', label: 'Voltar às aprovações' });
});

test('requesting adjustments continues in the matching studio for editors', () => {
  assert.deepEqual(reviewNextStep({ ...article, decision: 'changes_requested' }), { kind: 'studio', label: 'Ajustar artigo' });
  assert.deepEqual(reviewNextStep({ ...article, kind: 'carousel', decision: 'changes_requested' }), { kind: 'studio', label: 'Ajustar carrossel' });
});
