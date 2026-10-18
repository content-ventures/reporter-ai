'use client';

import type { StageView } from '@/domain/stage';
import type { ProductionDetail } from '@/ports';
import { currentStageWithResearch, RESEARCH_STAGE_ID, withResearchStage } from './journey';
import { researchHref } from './routes';
import { useOptionalHardNews } from './state/hard-news-provider';

export type Journey = {
  stages: StageView[];
  currentStageId: string;
  /** Where an added stage leads (Apuração); `undefined` for the production's own stages. */
  hrefOf: (stage: StageView) => string | undefined;
};

/**
 * The production's journey as the header shows it. Outside R2, or for a production that did not
 * come from the news desk, it is exactly the production's own stages.
 */
export function useJourney(production: ProductionDetail | undefined): Journey {
  const desk = useOptionalHardNews();
  const dossier = production ? desk?.state.dossiers[production.id] : undefined;
  if (!production) return { stages: [], currentStageId: '', hrefOf: () => undefined };
  return {
    stages: withResearchStage(production.stages, dossier),
    currentStageId: currentStageWithResearch(production.currentStageId, dossier),
    hrefOf: (stage) => (dossier && stage.id === RESEARCH_STAGE_ID ? researchHref(production.id) : undefined),
  };
}

/** Where a covered story opens while it is researched (the trail's title, the production index). */
export function useResearchHref(productionId: string): string | undefined {
  const desk = useOptionalHardNews();
  const dossier = desk?.state.dossiers[productionId];
  return dossier && dossier.stage !== 'article' ? researchHref(productionId) : undefined;
}
