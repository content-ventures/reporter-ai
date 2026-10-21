'use client';

import { Badge, BrandMark, CardHeader, Checkbox, List, ListItem, MetaList, PageStack, Prose, Section, TextLink } from '@content-ventures/design-system/v3';
import { newsLogoUrl } from '@/domain/news-branding';
import type { NewsSourceSuggestion } from '@/domain/news-discovery';
import type { NewsFeed } from '@/domain/hard-news';

/** Keep query parameters: two feeds of the same site can cover different subjects. */
export function sameFeed(left: string, right: string): boolean {
  try {
    const key = (value: string) => {
      const url = new URL(value);
      return `${url.host.toLowerCase()}${url.pathname.replace(/\/$/, '')}${url.search}`;
    };
    return key(left) === key(right);
  } catch { return left === right; }
}

export function registeredSource(suggestion: NewsSourceSuggestion, feeds: readonly NewsFeed[]): NewsFeed | undefined {
  return suggestion.feedUrl ? feeds.find(feed => sameFeed(feed.url, suggestion.feedUrl!)) : undefined;
}

export function selectableSource(suggestion: NewsSourceSuggestion): boolean {
  return suggestion.status === 'verified' && Boolean(suggestion.feedUrl);
}

function publishedOn(value?: string): string {
  const date = value ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : 'Data não informada';
}

/** Every proposed source keeps the search evidence and the articles actually read from its feed. */
export function DiscoveryResults({ suggestions, feeds, selected, toggle }: {
  suggestions: readonly NewsSourceSuggestion[];
  feeds: readonly NewsFeed[];
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
}) {
  return (
    <PageStack>
      {suggestions.map(suggestion => {
        const verified = selectableSource(suggestion);
        const existing = registeredSource(suggestion, feeds);
        return (
          <Section key={suggestion.id} variant="panel">
            <CardHeader title={suggestion.name} titleAs="h3"
              leading={<BrandMark name={suggestion.name} src={newsLogoUrl(suggestion.site)} size="sm" decorative />}
              actions={verified ? <Checkbox aria-label={`Selecionar ${suggestion.name}`} checked={Boolean(existing) || selected.has(suggestion.id)}
                disabled={Boolean(existing)} onChange={() => toggle(suggestion.id)} /> : undefined} />
            <MetaList size="sm" items={[
              <TextLink key="site" href={suggestion.site} external>{new URL(suggestion.site).hostname.replace(/^www\./, '')}</TextLink>,
              <Badge key="status" size="sm" variant="soft" tone={existing ? 'gray' : verified ? 'green' : 'amber'}>
                {existing ? 'Já cadastrada' : verified ? 'Feed confirmado' : suggestion.status === 'no-feed' ? 'Sem feed confirmado' : 'Indisponível'}
              </Badge>,
              verified ? `${suggestion.recentItems} ${suggestion.recentItems === 1 ? 'notícia' : 'notícias'} nos últimos 7 dias` : undefined,
            ]} />
            <Prose variant="compact" measure="wide">{suggestion.reason}</Prose>
            {suggestion.issue ? <Prose variant="compact" measure="wide">{suggestion.issue}</Prose> : null}
            {suggestion.sample.length ? (
              <List label={`Notícias de ${suggestion.name}`} framed={false} bleed>
                {suggestion.sample.slice(0, 2).map(sample => (
                  <ListItem key={sample.url} title={<TextLink href={sample.url} external>{sample.title}</TextLink>}
                    titleLines={2} description={publishedOn(sample.publishedAt)} density="sm" />
                ))}
              </List>
            ) : null}
            <TextLink href={suggestion.evidence.url} external>Ver referência da sugestão</TextLink>
          </Section>
        );
      })}
    </PageStack>
  );
}
