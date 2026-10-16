'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SkeletonText } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import { stageTargetHref } from '@/ui/routes';
import { currentStageTarget } from './journey';
import { useProductionFrame } from './production-context';

/**
 * `/productions/[id]` opens the stage the journey is on (it becomes the production hub with
 * "Peças" and "Gerações" in R1.x/R4); `currentStageTarget` holds the rule, which the trail's title
 * follows too. The frame shows the header meanwhile.
 */
export function ProductionIndex({ productionId }: { productionId: ProductionId }) {
  const router = useRouter();
  const { production } = useProductionFrame();
  const stage = currentStageTarget(production.data);
  const target = stage ? stageTargetHref(productionId, stage) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  return <SkeletonText lines={4} label="Abrindo a etapa atual" />;
}
