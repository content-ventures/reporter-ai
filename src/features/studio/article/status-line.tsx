'use client';

import { LinkButton, MetaList } from '@content-ventures/design-system/v3';
import { formatCount, plural } from '@/ui/format';
import { StatusBadge } from '@/ui/status-badge';
import { useStudio } from './studio-context';

/**
 * Status line under the text (PLAN §3.5): real counts of the text on screen, each one jumping to
 * the next pending item — "812 palavras · 4 min · 2 blocos da IA a revisar · 3/4 citações · 1
 * sugestão aberta". While a generation writes, the current step leads the line. While the AI text
 * is reviewed block by block, the line holds "Marcar como revisado · Próximo": below the text, so
 * nothing covers it. (The save state and the version menu sit at the end of the toolbar on a
 * desktop, and in the footer when narrow.)
 */
export function StatusLine() {
  const studio = useStudio();
  const { facts, generation } = studio;
  const step = generation.active ? generation.run?.steps.find((entry) => entry.state === 'current' || entry.state === 'awaiting_input') : undefined;
  const totalQuotes = facts.quotes.length;
  const open = studio.openSuggestions.length;
  const words = { value: plural(facts.words, 'palavra', 'palavras'), numeric: true };

  const reviewing = !generation.active && studio.reviewBlockId !== null ? facts.unreviewed.indexOf(studio.reviewBlockId) : -1;
  if (reviewing >= 0 && studio.reviewBlockId) {
    const blockId = studio.reviewBlockId;
    const total = facts.unreviewed.length;
    return (
      <MetaList
        size="sm"
        label="Revisão do texto da IA"
        items={[
          { value: `Bloco da IA ${formatCount(reviewing + 1)} de ${formatCount(total)}`, numeric: true },
          <LinkButton key="reviewed" tone="text" size="inherit" onClick={() => studio.actions.markReviewed([blockId])}>
            Marcar como revisado
          </LinkButton>,
          total > 1 ? (
            <LinkButton key="next" tone="text" size="inherit" onClick={studio.actions.nextAiBlock}>
              Ir para o próximo
            </LinkButton>
          ) : null,
          <LinkButton key="stop" tone="quiet" size="inherit" onClick={studio.actions.stopReview}>
            Sair da revisão
          </LinkButton>,
          words,
        ]}
      />
    );
  }

  // A generation that stopped short, with its partial on screen: the way on is right under the text
  // (on a phone the copilot is another tab).
  const run = generation.run;
  const stoppedShort = !generation.active && run && (run.status === 'failed' || run.status === 'cancelled') && generation.version?.interrupted && !studio.piece.draft.dirty;
  const recovery = stoppedShort ? (
    <LinkButton key="retry" tone="text" size="inherit" onClick={() => void (generation.retryable ? studio.actions.retryGeneration() : studio.actions.generate())}>
      {generation.retryable ? (run.status === 'failed' ? 'Tentar de novo' : 'Continuar de onde parou') : 'Gerar de novo'}
    </LinkButton>
  ) : null;

  const items = [
    step ? <StatusBadge key="run" kind="run" status="running" label={`Gerando · ${step.label}`} size="sm" /> : null,
    stoppedShort ? <StatusBadge key="stopped" kind="run" status={run.status} label={run.status === 'failed' ? 'Geração interrompida' : 'Geração parada'} size="sm" /> : null,
    recovery,
    words,
    facts.words > 0 ? { value: `${formatCount(facts.minutes)} min`, numeric: true } : null,
    // The approved version is on screen: the first edit starts a new draft (the approval stays).
    studio.approvedOnScreen ? `Editar cria um novo rascunho; a v${studio.approvedOnScreen.number} continua aprovada` : null,
    facts.unreviewed.length > 0 && !generation.active ? (
      <LinkButton key="ai" tone="text" size="inherit" onClick={studio.actions.nextAiBlock}>
        {plural(facts.unreviewed.length, 'bloco da IA a revisar', 'blocos da IA a revisar')}
      </LinkButton>
    ) : null,
    totalQuotes > 0 ? (
      facts.missingQuotes.length > 0 ? (
        <LinkButton key="quotes" tone="text" size="inherit" onClick={studio.actions.nextMissingQuote}>
          {`${facts.verifiedQuotes}/${totalQuotes} citações conferidas`}
        </LinkButton>
      ) : (
        `${facts.verifiedQuotes}/${totalQuotes} citações conferidas`
      )
    ) : null,
    open > 0 ? (
      <LinkButton key="suggestions" tone="text" size="inherit" onClick={studio.actions.nextSuggestion}>
        {plural(open, 'sugestão aberta', 'sugestões abertas')}
      </LinkButton>
    ) : null,
  ];

  return <MetaList items={items} size="sm" label="Situação do texto" />;
}
