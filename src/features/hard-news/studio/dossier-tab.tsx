'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { ButtonLink, List, ListItem, MetaList, Section } from '@content-ventures/design-system/v3';
import { acceptedSources, RESEARCH_KIND_LABELS } from '@/domain/hard-news';
import { DemoBadge } from '../demo-badge';
import { useHardNews } from '../state/hard-news-provider';
import { researchHref } from '../routes';
import type { DeskStudio } from './use-desk-studio';

/**
 * "Fontes": the studio's first tab for a covered news story (the transcript's place in R1): the
 * sources the text was written from, the quotes attached in the research and the way back to it.
 */
export function DossierTab({ desk }: { desk: DeskStudio }) {
  const workspaceHrefFor = useWorkspaceHref();
  const { state } = useHardNews();
  const sources = acceptedSources(desk.dossier);
  const quotes = state.quotes.filter((quote) => desk.dossier.quoteIds.includes(quote.id));
  const news = state.news.find((item) => item.id === desk.dossier.newsId);
  return (
    <>
      <Section title="Fontes da matéria" titleAs="h3" action={<><DemoBadge /><ButtonLink href={workspaceHrefFor(researchHref(desk.dossier.productionId))} variant="ghost" size="sm">Ver apuração</ButtonLink></>}>
        <List label="Fontes da matéria" framed={false} bleed empty="Nenhuma fonte aceita.">
          {sources.map((source) => (
            <ListItem
              key={source.id}
              title={source.title}
              titleLines={2}
              description={<MetaList size="sm" items={[RESEARCH_KIND_LABELS[source.kind], source.outlet]} />}
              href={workspaceHrefFor(source.url)}
            />
          ))}
        </List>
      </Section>
      {quotes.length > 0 ? (
        <Section title="Citações da pauta" titleAs="h3">
          <List label="Citações da pauta" framed={false} bleed>
            {quotes.map((quote) => (
              <ListItem key={quote.id} title={`“${quote.text}”`} titleLines={2} description={`${quote.author}, ${quote.role}`} />
            ))}
          </List>
        </Section>
      ) : null}
      {news ? (
        <Section title="Notícia de origem" titleAs="h3">
          <List label="Notícia de origem" framed={false} bleed>
            <ListItem title={news.title} titleLines={2} description={news.source} href={workspaceHrefFor(news.url)} />
          </List>
        </Section>
      ) : null}
    </>
  );
}
