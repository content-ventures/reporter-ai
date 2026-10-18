'use client';

import { useMemo } from 'react';
import type { ProductionListItem } from '@/ports';
import { acceptedSources, CMS_MODE_LABELS } from '@/domain/hard-news';
import type { Tone } from '@content-ventures/design-system/v3';
import { researchHref } from './routes';
import { useOptionalHardNews } from './state/hard-news-provider';

/** How a covered news story reads on the board, where it differs from an R1 production. */
export type DeskCard = {
  /** "Apuração" while the story is researched; else the production's own lane. */
  lane?: 'research';
  /** "Notícia · Agência Litoral" instead of "Sem material". */
  meta: string;
  /** The board's line ("Apuração · 3 fontes aceitas", "No CMS · Rascunho"). */
  situation?: { line: string; tone: Tone; live?: boolean };
  href?: string;
};

export type DeskBoard = {
  card: (item: ProductionListItem) => DeskCard | undefined;
};

/**
 * The board's view of the R2 news desk: undefined before R2 (no provider), so the R1 board is
 * exactly as it was; from R2, covered stories gain the "Apuração" lane and say where they came from.
 */
export function useDeskBoard(): DeskBoard | undefined {
  const desk = useOptionalHardNews();
  const state = desk?.state;
  return useMemo(() => {
    if (!state) return undefined;
    return {
      card(item) {
        const dossier = state.dossiers[item.id];
        if (!dossier) return undefined;
        const news = state.news.find((entry) => entry.id === dossier.newsId);
        const meta = `Notícia · ${news?.source ?? 'Notícias'}`;
        const delivery = state.deliveries[item.id];
        if (dossier.stage !== 'article') {
          const accepted = acceptedSources(dossier).length;
          const line = dossier.research === 'searching'
            ? 'Apuração · A IA está pesquisando'
            : dossier.stage === 'writing'
              ? 'Apuração · A IA está escrevendo'
              : dossier.outline
                ? 'Apuração · Outline pronto'
                : `Apuração · ${accepted} ${accepted === 1 ? 'fonte aceita' : 'fontes aceitas'}`;
          return {
            lane: 'research',
            meta,
            situation: { line, tone: 'blue', live: dossier.research === 'searching' || dossier.stage === 'writing' },
            href: researchHref(item.id),
          };
        }
        if (delivery?.state === 'sent') return { meta, situation: { line: `No CMS · ${CMS_MODE_LABELS[state.cms.mode]}`, tone: 'green' } };
        if (delivery?.state === 'failed') return { meta, situation: { line: 'CMS · Falhou', tone: 'red' } };
        return { meta };
      },
    };
  }, [state]);
}
