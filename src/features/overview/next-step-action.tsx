'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ButtonLink, TextLink, toast } from '@content-ventures/design-system/v3';
import type { DeskItem, InProgressItem } from '@/ports';
import { useCommands } from '@/state';
import { productionHref, stepTargetHref } from '@/ui/routes';

/**
 * The verb of a row (COPY §0.3): "Revisar", "Ajustar", "Tentar de novo", "Autorizar"… written on
 * the button, landing where the step happens. "Tentar de novo" on an article starts the draft
 * again and then opens the studio, where the writing banner shows it; any other step navigates.
 */

/** Accessible name that keeps the visible verb first: "Revisar: artigo de Aurora Calçados…". */
function nameOf(label: string, title: string, pieceLabel?: string): string {
  return pieceLabel ? `${label}: ${pieceLabel.toLowerCase()} de ${title}` : `${label}: ${title}`;
}

function RetryButton({ item, label }: { item: DeskItem & { pieceId: NonNullable<DeskItem['pieceId']> }; label: string }) {
  const commands = useCommands();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const step = item.nextStep;
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      aria-label={nameOf(label, item.productionTitle, item.pieceLabel)}
      onClick={() => {
        if (busy || !step) return;
        setBusy(true);
        void commands.generation.start('article.draft', { productionId: item.productionId, pieceId: item.pieceId }).then((result) => {
          setBusy(false);
          if (!result.ok) {
            toast('Não foi possível tentar de novo', { tone: 'error', description: result.refusal.message });
            return;
          }
          router.push(stepTargetHref(item.productionId, step.target));
        });
      }}
    >
      {label}
    </Button>
  );
}

/** Button of a "Precisa de você" row; nothing for "Aguardando outra pessoa" (no move of the viewer's). */
export function DeskAction({ item }: { item: DeskItem }) {
  const step = item.nextStep;
  if (!step) return null;
  if (step.kind === 'retry' && item.kind === 'article' && item.pieceId) {
    return <RetryButton item={{ ...item, pieceId: item.pieceId }} label={step.label} />;
  }
  return (
    <ButtonLink
      variant="secondary"
      size="sm"
      href={stepTargetHref(item.productionId, step.target)}
      aria-label={nameOf(step.label, item.productionTitle, item.pieceLabel)}
    >
      {step.label}
    </ButtonLink>
  );
}

/** Quiet text link of an "Em andamento" / "Equipe" row: "Continuar", "Abrir", "Reenviar"… */
export function ProgressAction({ item }: { item: InProgressItem }) {
  const step = item.nextStep;
  const label = step?.label ?? 'Abrir';
  const href = step ? stepTargetHref(item.productionId, step.target) : productionHref(item.productionId);
  return (
    <TextLink size="sm" href={href} aria-label={nameOf(label, item.productionTitle)}>
      {label}
    </TextLink>
  );
}
