'use client';

import type { ReactElement } from 'react';
import { writingParts, type GenerationRun } from '@/domain';
import { errorNotice, NOTICE_VERBS, writingNotice, type ApprovalSubject } from './approval-copy';
import { StatusBanner } from './status-banner';
import { generationFeedback, type FeedbackRun } from './generation-feedback';

/**
 * The AI at work, above the text: "A IA está escrevendo · parte 2 de 4. Você pode ler enquanto
 * isso." while the run writes (no verb: the run goes to the end), "A IA parou ao escrever a
 * parte 2 de 4. O que já foi escrito está salvo. · Tentar de novo" when it failed. Nothing for a finished run, one the
 * person stopped or a reload interrupted (not failures), or one waiting for the person (the
 * screen that resumes it asks its own question). The screen has no header primary meanwhile:
 * the notice verb is the only action (CONTRACT R6).
 */

export type GenerationBannerProps = {
  /** The piece's latest run (`RunView`, or any run with its steps). */
  run: FeedbackRun | undefined;
  subject: ApprovalSubject;
  /** "Tentar de novo" (absent: no verb). */
  onRetry?: () => void;
  /** The verb is running (starting the retry). */
  busy?: boolean;
};

export function GenerationBanner({ run, subject, onRetry, busy = false }: GenerationBannerProps): ReactElement | null {
  if (!run) return null;
  const parts = writingParts(run);
  if (run.status === 'queued' || run.status === 'running') {
    return (
      <StatusBanner kind="writing" busy>
        {run.model?.engine === 'provider' ? generationFeedback(run).notice : writingNotice(subject, parts)}
      </StatusBanner>
    );
  }
  if (run.status === 'failed') {
    const failedStep = run.steps.find(step => step.state === 'error');
    return (
      <StatusBanner kind="error" action={onRetry ? { label: NOTICE_VERBS.retry, onClick: onRetry, loading: busy } : undefined}>
        {run.model?.engine === 'provider' ? `${failedStep ? `Parou em ${failedStep.label}. ` : ''}${run.error?.message ?? 'A geração foi interrompida.'} Seu material e a versão anterior continuam salvos.` : errorNotice(subject, stoppedInPart(run) ? parts : undefined)}
      </StatusBanner>
    );
  }
  return null;
}

const isPart = (id: string) => id === 'intro' || /^section-\d+$/.test(id);

/** The AI stopped while writing the text itself (not while reading the material or planning). */
function stoppedInPart(run: Pick<GenerationRun, 'steps'>): boolean {
  return run.steps.some((step) => isPart(step.id) && (step.state === 'error' || step.state === 'done'));
}
