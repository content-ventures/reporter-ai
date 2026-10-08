'use client';

import { useId } from 'react';
import { ActionBar, Button, MetaList } from '@content-ventures/design-system/v3';
import { Check, CornerDownLeft } from '@content-ventures/design-system/v3/icons';
import type { PieceKind } from '@/domain';
import type { Guard } from '@/ports';
import { approveLabel } from './review-model';

/**
 * Decision bar of the guided review (COPY §4.4): the facts of the piece at the start ("Artigo · 1,4
 * de 2 laudas · enviado por Juliana"), the visible reason when a decision is blocked (never only a
 * tooltip), "Pedir ajustes" (secondary) and "Aprovar artigo" / "Aprovar carrossel" (primary). A
 * blocked button stays focusable (`aria-disabled`) and points at the reason. No version numbers.
 */
export type DecisionBarProps = {
  kind: PieceKind;
  /** "Artigo", "1,4 de 2 laudas", "enviado por Juliana": one fact each. */
  facts: readonly string[];
  approve: Guard;
  requestChanges: Guard;
  onApprove: () => void;
  onReturn: () => void;
};

export function DecisionBar({ kind, facts, approve, requestChanges, onApprove, onReturn }: DecisionBarProps) {
  const reasonId = useId();
  const reason = !approve.allowed ? approve.reason : !requestChanges.allowed ? requestChanges.reason : undefined;
  return (
    <ActionBar position="static" start={<MetaList size="sm" items={[...facts]} />} detail={reason} detailId={reasonId}>
      <Button
        variant="secondary"
        icon={CornerDownLeft}
        aria-disabled={requestChanges.allowed ? undefined : true}
        aria-describedby={requestChanges.allowed ? undefined : reasonId}
        onClick={requestChanges.allowed ? onReturn : undefined}
      >
        Pedir ajustes
      </Button>
      <Button
        variant="primary"
        icon={Check}
        aria-disabled={approve.allowed ? undefined : true}
        aria-describedby={approve.allowed ? undefined : reasonId}
        onClick={approve.allowed ? onApprove : undefined}
      >
        {approveLabel(kind)}
      </Button>
    </ActionBar>
  );
}
