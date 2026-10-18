'use client';

import type { ReactNode } from 'react';
import { Panel, Section, StepPipeline } from '@content-ventures/design-system/v3';
import type { PipelineStage } from '@content-ventures/design-system/v3';

export type HowStep = { id: string; label: string; detail: string };

/**
 * "Como funciona" of a desk setting: where the setting enters the newsroom's work, as numbered
 * steps (the DS journey), so a person who opens it once a month knows what it changes.
 */
export function HowItWorks({ label, steps, action }: { label: string; steps: readonly HowStep[]; action?: ReactNode }) {
  const stages: PipelineStage[] = steps.map((step) => ({ id: step.id, label: step.label, detail: step.detail, state: 'upcoming' }));
  return (
    <Panel label="Como funciona">
      <Section title="Como funciona" action={action}>
        <StepPipeline variant="journey" label={label} stages={stages} />
      </Section>
    </Panel>
  );
}
