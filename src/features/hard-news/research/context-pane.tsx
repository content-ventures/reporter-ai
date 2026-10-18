'use client';

import { useMemo } from 'react';
import { Avatar, Badge, Button, List, ListItem, MetaList, Section } from '@content-ventures/design-system/v3';
import { Check, Plus } from '@content-ventures/design-system/v3/icons';
import type { HardNewsDossier, NewsItem } from '@/domain/hard-news';
import { useHardNews } from '../state/hard-news-provider';
import { searchArchive } from '../state/archive-search';

/**
 * The research's side panel: own context the draft may use (F2.11 quote bank, F2.12 archive)
 * and the writing guide it will follow. Attaching a quote makes it available to the draft.
 */
export function ContextPane({ dossier, news }: { dossier: HardNewsDossier; news: NewsItem }) {
  const { state, actions } = useHardNews();
  const topic = news.classification?.topic ?? '';
  // Quotes on the story's topic, the ones sharing words with the news first (attached ones always).
  const quotes = useMemo(() => {
    const words = new Set(`${news.title} ${news.excerpt}`.toLowerCase().split(/[^a-zà-ú0-9]+/).filter((word) => word.length > 5));
    const shared = (text: string) => text.toLowerCase().split(/[^a-zà-ú0-9]+/).filter((word) => words.has(word)).length;
    return state.quotes
      .filter((quote) => quote.topic === topic || dossier.quoteIds.includes(quote.id))
      .map((quote) => ({ quote, score: (dossier.quoteIds.includes(quote.id) ? 10 : 0) + shared(`${quote.text} ${quote.context}`) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((entry) => entry.quote);
  }, [dossier.quoteIds, news.excerpt, news.title, state.quotes, topic]);
  const archive = useMemo(
    () => searchArchive(news.title, state.archive.filter((article) => article.index === 'indexed')).slice(0, 4),
    [news.title, state.archive],
  );

  return (
    <>
      <Section title="Citações" meta={quotes.length ? `${dossier.quoteIds.length} na matéria` : undefined}>
        <List label="Citações do banco" framed={false} bleed empty="Nenhuma fala sobre o tema no banco.">
          {quotes.map((quote) => {
            const attached = dossier.quoteIds.includes(quote.id);
            return (
              <ListItem
                key={quote.id}
                leading={<Avatar name={quote.author} size="sm" decorative />}
                title={`“${quote.text}”`}
                titleLines={2}
                description={`${quote.author}, ${quote.role}`}
                actions={(
                  <Button
                    variant={attached ? 'soft' : 'ghost'}
                    size="sm"
                    icon={attached ? Check : Plus}
                    aria-pressed={attached}
                    disabled={!quote.verified}
                    onClick={() => actions.toggleDossierQuote(dossier.productionId, quote.id)}
                  >
                    {attached ? 'Na matéria' : quote.verified ? 'Usar' : 'Não conferida'}
                  </Button>
                )}
              />
            );
          })}
        </List>
      </Section>
      <Section title="Do acervo">
        <List label="Matérias do acervo" framed={false} bleed empty="Nada parecido no acervo.">
          {archive.map((article) => (
            <ListItem
              key={article.id}
              title={article.title}
              titleLines={2}
              description={<MetaList size="sm" items={[article.section, new Date(article.publishedAt).toLocaleDateString('pt-BR')]} />}
              href={article.url}
            />
          ))}
        </List>
      </Section>
      <Section title="Guia de escrita" meta={`v${state.guide.version}`} action={<Badge tone="gray" variant="soft" size="sm">Aplicado</Badge>}>
        <List label="Guia de escrita" framed={false} bleed>
          <ListItem title="Voz" description={state.guide.voice} />
          <ListItem title="Título" description={state.guide.headline} />
          <ListItem title="Atribuição" description={state.guide.attribution} />
        </List>
      </Section>
    </>
  );
}
