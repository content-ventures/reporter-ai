import type { StageView } from '@/domain/stage';
import type { HardNewsDossier } from '@/domain/hard-news';

/**
 * A covered news story starts with "Apuração" (F2.6, F2.7): research and outline before the
 * article. The stage is added in front of the production's own journey, so the same header menu
 * reads "Apuração · 1 de 4" and the article, approval and delivery stages keep their rules.
 */

export const RESEARCH_STAGE_ID = 'research';

export function withResearchStage(stages: readonly StageView[], dossier: HardNewsDossier | undefined): StageView[] {
  if (!dossier) return [...stages];
  const researching = dossier.stage !== 'article';
  const research: StageView = {
    id: RESEARCH_STAGE_ID,
    label: 'Apuração',
    kind: 'source',
    state: researching ? 'current' : 'done',
    status: researching ? 'waiting' : 'completed',
    selectable: true,
    detail: researching ? (dossier.research === 'searching' ? 'A IA está pesquisando' : 'Em andamento') : undefined,
  };
  const rest = stages.map((stage) => (researching && stage.state === 'current'
    ? { ...stage, state: 'upcoming' as const, blockedReason: undefined, detail: undefined }
    : stage));
  return [research, ...rest];
}

/** The journey stage a covered story is on: Apuração until the article is written. */
export function currentStageWithResearch(currentStageId: string, dossier: HardNewsDossier | undefined): string {
  return dossier && dossier.stage !== 'article' ? RESEARCH_STAGE_ID : currentStageId;
}
