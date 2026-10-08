'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonText } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import { reviewHref, stageHref } from '@/ui/routes';
import { decidesAt } from './journey';
import { useProductionFrame } from './production-context';

/**
 * `/productions/[id]` opens the stage the journey is on (it becomes the production hub with
 * "Peças" and "Gerações" in R1.x/R4). On the approval stage, whoever decides lands on the guided
 * review and everyone else on the piece's studio; a piece whose approval lives inside its own stage
 * (the carousel) opens the review too when it waits for this viewer. The frame shows the header
 * meanwhile.
 */
export function ProductionIndex({ productionId }: { productionId: ProductionId }) {
  const router = useRouter();
  const { production } = useProductionFrame();
  const detail = production.data;
  const stage = detail?.stages.find((candidate) => candidate.id === detail.currentStageId);
  const approval = stage?.pieceKind ? detail?.approvals[stage.pieceKind] : undefined;
  // Sent to this viewer, or to nobody in particular while they may decide (their "Para aprovar").
  const waitsForViewer =
    stage?.kind === 'piece' &&
    approval?.state === 'awaiting' &&
    approval.viewer.canDecide &&
    (approval.viewer.isAssignee || !approval.request?.assignee);
  const target = !stage
    ? null
    : waitsForViewer && stage.pieceKind
      ? reviewHref(productionId, stage.pieceKind)
      : stageHref(productionId, stage, { canDecide: decidesAt(detail?.approvals, stage.pieceKind) });

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  return <SkeletonText lines={4} label="Abrindo a etapa atual" />;
}
