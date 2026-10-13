'use client';

import { Alert, LinkButton } from '@content-ventures/design-system/v3';
import { plural } from '@/ui/format';

/**
 * Amber notice when the article got a newer approved version than the one the slides were
 * written from (PLAN §3.7). "Atualizar slides" proposes one suggestion per affected slide;
 * "Manter versão N" keeps the carousel on the old version. Slide edits are never discarded.
 */
export function OutdatedNotice({
  from,
  to,
  pending,
  updating,
  onUpdate,
  onKeep,
  onAcceptAll,
  onDiscardAll,
}: {
  from: number;
  to: number;
  /** Update suggestions still waiting for a decision. */
  pending: number;
  updating: boolean;
  onUpdate: () => void;
  onKeep: () => void;
  onAcceptAll: () => void;
  onDiscardAll: () => void;
}) {
  if (updating) {
    return (
      <Alert
        tone="warning"
        title={`Atualizando para a versão ${to}`}
        meta={plural(pending, 'slide com sugestão', 'slides com sugestão')}
        end={
          <LinkButton tone="inherit" onClick={onDiscardAll}>
            Descartar todas
          </LinkButton>
        }
        action={<LinkButton onClick={onAcceptAll}>Aceitar todas</LinkButton>}
      />
    );
  }
  return (
    <Alert
      tone="warning"
      title={`O artigo aprovado mudou para a versão ${to}.`}
      meta={`Slides escritos a partir da versão ${from}`}
      end={
        <LinkButton tone="inherit" onClick={onKeep}>
          Manter versão {from}
        </LinkButton>
      }
      action={<LinkButton onClick={onUpdate}>Atualizar slides</LinkButton>}
    />
  );
}
