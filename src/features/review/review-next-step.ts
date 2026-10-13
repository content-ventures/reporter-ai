import type { PieceKind } from '../../domain/piece.ts';
import type { PieceStatus } from '../../domain/rules/status.ts';

export type ReviewNextStep = { kind: 'carousel' | 'delivery' | 'studio' | 'next_review' | 'approvals'; label: string };

/** Continue the production for editors; continue the queue for review-only members. */
export function reviewNextStep(input: {
  kind: PieceKind;
  decision: 'approved' | 'changes_requested';
  canEdit: boolean;
  plannedCarousel: boolean;
  carouselStatus?: PieceStatus;
  hasNextInQueue: boolean;
}): ReviewNextStep {
  if (!input.canEdit) return input.hasNextInQueue
    ? { kind: 'next_review', label: 'Revisar próxima produção' }
    : { kind: 'approvals', label: 'Voltar às aprovações' };
  if (input.decision === 'changes_requested') return {
    kind: 'studio', label: input.kind === 'article' ? 'Ajustar artigo' : 'Ajustar carrossel',
  };
  if (input.kind === 'article' && input.plannedCarousel && input.carouselStatus !== 'approved') {
    const empty = !input.carouselStatus || input.carouselStatus === 'not_started' || input.carouselStatus === 'locked';
    return { kind: 'carousel', label: empty ? 'Criar carrossel' : 'Abrir o carrossel' };
  }
  return { kind: 'delivery', label: 'Ir para entrega' };
}
