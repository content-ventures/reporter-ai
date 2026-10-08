'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonText } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import { stageHref } from '@/ui/routes';
import { useProductionFrame } from './production-context';

/**
 * `/productions/[id]` opens the stage the journey is on (it becomes the production hub with
 * "Peças" and "Gerações" in R1.x/R4). The frame already shows the header while this resolves.
 */
export function ProductionIndex({ productionId }: { productionId: ProductionId }) {
  const router = useRouter();
  const { production } = useProductionFrame();
  const detail = production.data;
  const stage = detail?.stages.find((candidate) => candidate.id === detail.currentStageId);
  const target = stage ? stageHref(productionId, stage) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  return <SkeletonText lines={4} label="Abrindo a etapa atual" />;
}
