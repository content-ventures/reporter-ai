'use client';

import type { ReactElement } from 'react';
import { writingParts, type GenerationRun } from '@/domain';
import { errorNotice, NOTICE_VERBS, writingNotice, type ApprovalSubject } from './approval-copy';
import { StatusBanner } from './status-banner';

/**
 * The AI at work, above the text: "A IA está escrevendo · parte 2 de 4. Você pode ler enquanto
 * isso. · Parar" while the run writes, "A IA parou ao escrever a parte 2 de 4. O que já foi
 * escrito está salvo. · Tentar de novo" when it failed. Nothing for a finished run, one the
 * person stopped or a reload interrupted (not failures), or one waiting for the person (the
 * screen that resumes it asks its own question). The screen has no header primary meanwhile:
 * the notice verb is the only action (CONTRACT R6).
 */

export type GenerationBannerProps = {
  /** The piece's latest run (`RunView`, or any run with its steps). */
  run: Pick<GenerationRun, 'status' | 'steps'> | undefined;
  subject: ApprovalSubject;
  /** "Parar" (absent: no verb, e.g. a reader who cannot edit). */
  onStop?: () => void;
  /** "Tentar de novo" (absent: no verb). */
  onRetry?: () => void;
  /** The verb is running (stopping or starting the retry). */
  busy?: boolean;
};

export function GenerationBanner({ run, subject, onStop, onRetry, busy = false }: GenerationBannerProps): ReactElement | null {
  if (!run) return null;
  const parts = writingParts(run);
  if (run.status === 'queued' || run.status === 'running') {
    return (
      <StatusBanner kind="writing" busy action={onStop ? { label: NOTICE_VERBS.stop, onClick: onStop, loading: busy } : undefined}>
        {writingNotice(subject, parts)}
      </StatusBanner>
    );
  }
  if (run.status === 'failed') {
    return (
      <StatusBanner kind="error" action={onRetry ? { label: NOTICE_VERBS.retry, onClick: onRetry, loading: busy } : undefined}>
        {errorNotice(subject, stoppedInPart(run) ? parts : undefined)}
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
