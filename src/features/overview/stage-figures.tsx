'use client';

import { MetricStrip } from '@content-ventures/design-system/v3';
import type { DeskView, TeamStage } from '@/ports';
import { PRODUCTIONS_HREF } from '@/ui/routes';

/** The journey's stages in reading order, as the board names them. */
export const STAGE_FIGURES: readonly { stage: TeamStage; label: string }[] = [
  { stage: 'material', label: 'Material' },
  { stage: 'writing', label: 'Artigo' },
  { stage: 'approval', label: 'Aprovação' },
  { stage: 'carousel', label: 'Carrossel' },
  { stage: 'delivery', label: 'Entrega' },
];

/** How many productions sit in each stage; every figure opens the productions board. */
export function StageFigures({ desk }: { desk: DeskView | undefined }) {
  return (
    <MetricStrip
      label="Produções por etapa"
      items={STAGE_FIGURES.map(({ stage, label }) => ({
        label,
        value: desk?.team.find((group) => group.stage === stage)?.items.length ?? 0,
        loading: !desk,
        href: PRODUCTIONS_HREF,
      }))}
    />
  );
}
