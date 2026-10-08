'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Grid, LinkButton, List, Section, SourceChip, useWorkspace } from '@content-ventures/design-system/v3';
import type { ProductionDetail, PersonSummary, ReviewView, VersionView } from '@/ports';
import { ChecksList } from '@/ui/checks-list';
import { plural } from '@/ui/format';
import { pieceHref } from '@/ui/routes';
import { resolveChip } from '@/ui/source-chip-for';
import { ReviewHistory } from './review-history';
import { groupEvidence, reviewHistory, shortExcerpt } from './review-model';

/**
 * Side pane of the review (PLAN §3.6): Checagem (same registry as the studio, jump back to fix),
 * Fonte (every passage the text stands on, checked against the material — "Falta" in red), and
 * Histórico (versions, decisions and AI provenance).
 */

const HISTORY_PAGE = 6;

export type ReviewAsideProps = {
  review: ReviewView;
  production: ProductionDetail;
  versions: readonly VersionView[];
  people: readonly PersonSummary[] | undefined;
  /** Light the blocks a source chip backs (hover/focus), or `[]`. */
  onLight: (blockIds: readonly string[]) => void;
  /** "Mostrar no texto": open the final text at the first block using the source. */
  onShow: (blockId: string) => void;
};

export function ReviewAside({ review, production, versions, people, onLight, onShow }: ReviewAsideProps) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const history = useMemo(() => reviewHistory(review, versions), [review, versions]);
  const studio = pieceHref(review.productionId, review.kind);
  const { readiness } = review;

  const groups = useMemo(() => groupEvidence(review.evidence), [review.evidence]);
  const missing = review.evidence.filter((entry) => entry.status === 'missing').length;
  const checksMeta = readiness.blockers.length > 0 ? 'Bloqueia a aprovação' : `${readiness.passed} de ${readiness.total}`;

  return (
    <>
      <Section title="Checagem" titleAs="h2" meta={checksMeta} metaTone={readiness.blockers.length > 0 ? 'missing' : 'muted'}>
        <ChecksList checks={review.checks} headingLevel="h3" jumpLabel="Abrir no estúdio" onJump={() => router.push(studio)} />
      </Section>

      <Section
        title="Fonte"
        titleAs="h2"
        meta={missing > 0 ? plural(missing, 'falta', 'faltam') : review.evidence.length > 0 ? plural(review.evidence.length, 'trecho', 'trechos') : undefined}
        metaTone={missing > 0 ? 'missing' : 'muted'}
      >
        {review.kind === 'article' && review.evidence.length === 0 ? (
          <List label="Trechos usados no texto" framed={false} dividers={false} empty="Nenhum trecho ligado ao material" />
        ) : review.kind === 'article' ? (
          <Grid columns="auto" min={200} as="ul" label="Trechos usados no texto">
            {groups.map((group) => {
              const first = group.entries[0];
              const chip = first ? resolveChip(first.ref, { evidence: first }) : undefined;
              const blockId = group.blockIds[0];
              const show = () => {
                if (!blockId) return;
                onShow(blockId);
                if (workspace?.narrow) workspace.setView('main');
              };
              const count = group.entries.length;
              const excerpt = first?.excerpt ? `“${shortExcerpt(first.excerpt, 140)}”` : undefined;
              return (
                <SourceChip
                  key={group.key}
                  kind={chip?.kind ?? 'excerpt'}
                  label={group.speaker?.person?.name ?? group.speaker?.label ?? 'Trecho'}
                  meta={count > 1 ? plural(count, 'trecho', 'trechos') : chip?.meta}
                  preview={excerpt ? (count > 1 ? `${excerpt} +${count - 1}` : excerpt) : undefined}
                  state={group.missing ? 'missing' : 'used'}
                  onOpen={blockId ? show : undefined}
                  openLabel="Mostrar no texto"
                  onPointerEnter={() => onLight(group.blockIds)}
                  onPointerLeave={() => onLight([])}
                  onFocus={() => onLight(group.blockIds)}
                  onBlur={() => onLight([])}
                />
              );
            })}
          </Grid>
        ) : (
          <Grid columns="auto" min={200} as="ul" label="Origem do carrossel">
            {review.version.inputs.map((input) => (
              <SourceChip
                key={input.versionId}
                kind="file"
                label={`Artigo v${input.number}`}
                meta={review.freshness.staleInputs.some((stale) => stale.input.versionId === input.versionId) ? 'versão anterior' : 'aprovada'}
              />
            ))}
            {production.sources.map((source) => (
              <SourceChip key={source.id} kind="transcript" label={source.title} meta={`v${source.version}`} />
            ))}
          </Grid>
        )}
      </Section>

      <Section
        title="Histórico"
        titleAs="h2"
        action={
          history.length > historyLimit ? (
            <LinkButton tone="quiet" onClick={() => setHistoryLimit((limit) => limit + HISTORY_PAGE)}>
              Mostrar mais
            </LinkButton>
          ) : undefined
        }
      >
        <ReviewHistory review={review} items={history} limit={historyLimit} people={people} />
      </Section>
    </>
  );
}
