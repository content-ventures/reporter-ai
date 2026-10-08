'use client';

import { Fragment, type ReactNode } from 'react';
import { ActionBar, Badge, Button, ConfirmDialog, LinkButton, MetaList, SaveIndicator, Tooltip } from '@content-ventures/design-system/v3';
import { Check } from '@content-ventures/design-system/v3/icons';
import { charactersAbove } from '@/domain';
import { formatCharacters, formatLaudasOf, plural } from '@/ui/format';
import { useStudio } from './studio-context';
import { footerNeeds } from './studio-model';

/** Speakers of the material still without a person or "Sem atribuição" (A07). */
export function useSpeakersWithoutPerson(): number {
  const { production } = useStudio();
  return production.participants.filter((participant) => !participant.person && !participant.unattributed).length;
}

/**
 * "Reescrever o artigo do zero?" (⋯, D2): the AI writes a new text from the interview; the text
 * on screen stays in the version history. Says when the brief changed since the text was written
 * and when speakers still have no person (their lines would be quoted without a name).
 */
export function RewriteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const unmapped = useSpeakersWithoutPerson();
  const notes = [
    'A IA escreve um texto novo a partir da entrevista. O texto atual fica no histórico de versões.',
    studio.briefChanged ? 'A IA escreve com a pauta nova.' : null,
    unmapped > 0 ? `${plural(unmapped, 'falante sem pessoa', 'falantes sem pessoa')}: as falas deles saem sem nome.` : null,
  ].filter(Boolean);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Reescrever o artigo do zero?"
      description={notes.join(' ')}
      confirmLabel="Reescrever"
      cancelLabel="Cancelar"
      onConfirm={() => studio.actions.generate()}
    />
  );
}

/**
 * Save state at the end of the toolbar, bound to the real save: "Salvo", "Salvando…", or "Não
 * foi possível salvar" with "Tentar de novo" (a conflict with another tab reloads). A text waiting
 * for approval is never written, so a refused save never shows here as an error.
 */
export function StudioSaveState() {
  const { sync } = useStudio();
  return (
    <SaveIndicator
      status={sync.status.status}
      label={sync.status.status === 'saved' ? 'Salvo' : sync.status.label}
      onRetry={sync.status.conflict ? () => window.location.reload() : sync.retry}
    />
  );
}

/**
 * The review of the AI text, ONE for the whole draft, on the footer's right side while the draft
 * has AI text: "Texto ainda não revisado" with "Marcar como revisado", then "Texto revisado" with
 * "Desfazer". New AI text (a run, an accepted suggestion) brings the first state back by itself;
 * typing does not. Whoever cannot edit (waiting for approval, another tab) only reads the state.
 */
export function TextReviewControl() {
  const studio = useStudio();
  const { facts, generation, actions } = studio;
  if (facts.review === 'none' || generation.active) return null;
  const editable = studio.canEdit && !studio.refusal;
  if (facts.review === 'reviewed') {
    return (
      <>
        <Badge tone="green" variant="text" size="md">
          Texto revisado
        </Badge>
        {editable ? (
          <LinkButton tone="text" onClick={actions.unmarkTextReviewed}>
            Desfazer
          </LinkButton>
        ) : null}
      </>
    );
  }
  return (
    <>
      <Badge tone="amber" variant="text" size="md">
        Texto ainda não revisado
      </Badge>
      {editable ? (
        <Button size="sm" icon={Check} onClick={actions.markTextReviewed}>
          Marcar como revisado
        </Button>
      ) : null}
    </>
  );
}

/**
 * The studio footer (D2, COPY §2.5). Left: the size against the brief, "1,6 de 2 laudas · 3.360
 * caracteres" (the real word count in a tooltip; above the maximum it offers to shorten), and what
 * stands between the text and "Enviar para aprovação": "Falta para enviar: 1 sugestão · 1
 * citação", each part jumping to the next spot, or "Pronto para enviar" (said only while sending
 * is the next step). Right: the review of the whole text (`TextReviewControl`). Narrow (inside
 * the bottom bar): "1,6 de 2 laudas · Falta 5 · Marcar como revisado", one line.
 */
export function StudioFooter({ narrow = false }: { narrow?: boolean }) {
  const studio = useStudio();
  const { facts, approval, generation } = studio;
  const size = studio.production.brief.size;
  const chars = facts.characters;
  const above = charactersAbove(chars, size);
  const reading = `${plural(facts.words, 'palavra', 'palavras')} · ${facts.minutes} min de leitura`;

  const sizeItem =
    chars === 0 ? (
      'Sem texto'
    ) : above > 0 ? (
      <LinkButton key="size" tone="text" size="inherit" onClick={() => studio.actions.runTool('shorten-to-brief')}>
        {`${formatLaudasOf(chars, size)} · ${formatCharacters(above)} acima`}
      </LinkButton>
    ) : (
      <Tooltip key="size" content={reading}>
        {narrow ? formatLaudasOf(chars, size) : `${formatLaudasOf(chars, size)} · ${formatCharacters(chars)}`}
      </Tooltip>
    );

  const state = approval?.state ?? 'none';
  const sending = Boolean(approval?.viewer.canSend) && !generation.active && (state === 'none' || state === 'changes_requested' || state === 'approval_outdated');
  const needs = footerNeeds(studio.sendItems);
  let needsItem: ReactNode = null;
  if (sending && narrow) {
    const first = needs.parts[0];
    if (needs.ready) needsItem = 'Pronto para enviar';
    else if (first) {
      needsItem = (
        <LinkButton key="needs" tone="text" size="inherit" onClick={() => studio.actions.jumpTo(first.target, first.id)}>
          {`Falta ${needs.total}`}
        </LinkButton>
      );
    }
  } else if (sending && (needs.ready || needs.parts.length > 0)) {
    const links = needs.parts.map((part, index) => (
      <Fragment key={part.id}>
        {index > 0 ? ' · ' : null}
        <LinkButton tone="text" size="inherit" onClick={() => studio.actions.jumpTo(part.target, part.id)}>
          {part.text}
        </LinkButton>
      </Fragment>
    ));
    needsItem = needs.ready ? (
      'Pronto para enviar'
    ) : (
      <Fragment key="needs">
        {'Falta para enviar: '}
        {links}
      </Fragment>
    );
  }

  if (narrow) {
    // The bottom bar has one line: the review is a link there ("Texto revisado" once marked).
    const reviewItem =
      facts.review === 'none' || generation.active ? null : facts.review === 'reviewed' ? (
        'Texto revisado'
      ) : studio.canEdit && !studio.refusal ? (
        <LinkButton key="review" onClick={studio.actions.markTextReviewed}>
          Marcar como revisado
        </LinkButton>
      ) : (
        'Texto não revisado'
      );
    return <MetaList size="sm" label="Situação do texto" items={[sizeItem, needsItem, reviewItem]} />;
  }
  return (
    <ActionBar position="static" start={<MetaList size="sm" label="Situação do texto" items={[sizeItem, needsItem]} />}>
      <TextReviewControl />
    </ActionBar>
  );
}
