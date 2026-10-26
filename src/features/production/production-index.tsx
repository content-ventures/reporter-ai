'use client';

import { useEffect } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import { SkeletonText } from '@content-ventures/design-system/v3';
import type { ProductionId } from '@/domain';
import { stageTargetHref } from '@/ui/routes';
import { currentStageTarget } from './journey';
import { useProductionFrame } from './production-context';
import { useResearchHref } from '@/features/hard-news/use-journey';

/**
 * `/productions/[id]` opens the stage the journey is on (it becomes the production hub with
 * "Peças" and "Gerações" in R1.x/R4); `currentStageTarget` holds the rule, which the trail's title
 * follows too. The frame shows the header meanwhile.
 */
export function ProductionIndex({ productionId }: { productionId: ProductionId }) {
  const router = useRouter();
  const { production } = useProductionFrame();
  const stage = currentStageTarget(production.data);
  // R2: a covered news story still being researched opens on its Apuração.
  const researching = useResearchHref(productionId);
  const target = researching ?? (stage ? stageTargetHref(productionId, stage) : null);

  useEffect(() => {
    if (target) router.replace(target);
  }, [router, target]);

  return <SkeletonText lines={4} label="Abrindo a etapa atual" />;
}
