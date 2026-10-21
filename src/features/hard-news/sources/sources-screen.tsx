'use client';

import { newsLogoUrl } from '@/domain/news-branding';

import { useState } from 'react';
import {
  AttachedNote,
  Badge,
  BrandMark,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterBand,
  FilterBar,
  FilterField,
  Grid,
  IconButton,
  LinkButton,
  Menu,
  MetaList,
  MetricStrip,
  PageHeader,
  PageStack,
  Select,
  Sparkline,
  toast,
} from '@content-ventures/design-system/v3';
import { AlertTriangle, Ellipsis, Pause, Play, Plus, RefreshCw, Rss, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { NewsFeed } from '@/domain/hard-news';
import { isRateableNewsSource, SOURCE_RELEVANCE_LABELS, SOURCE_TIER_LABELS, sourceRatingRank } from '@/domain/news-source-rating';
import { useCan } from '@/state';
import { useBreadcrumb } from '@/ui/shell';
import { RelativeTime } from '@/ui/time';
import { NEWS_HREF } from '../routes';
import { useHardNews, useNewsWatch } from '../state/hard-news-provider';
import { SourceRatingBadge } from '../source-rating';
import { AddFeedDialog } from './add-feed-dialog';
import { DiscoverSourcesDialog } from './discover-sources-dialog';
import { FEED_STATE, feedOrigin, INTERVAL_OPTIONS } from './feed-format';
import { SourceRatingDialog } from './source-rating-dialog';

/**
 * Fontes (F2.1, REQ-2.1): the RSS feeds the desk reads, how often, and whether each one answers.
 * A feed that stopped answering comes first, with "Tentar de novo"; the table keeps frequency,
 * last read and the day's count per feed. Removing a feed never removes the news it brought.
 */
export function SourcesScreen() {
  const { state, ready, actions, live, newsFailed } = useHardNews();
  const canEdit = useCan('production.edit');
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removing, setRemoving] = useState<NewsFeed>();
  const [rating, setRating] = useState<{ id: string; mode: 'view' | 'edit' }>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState('all');
  const [relevanceFilter, setRelevanceFilter] = useState('all');
  const [order, setOrder] = useState('current');
  useBreadcrumb([{ label: 'Notícias', href: NEWS_HREF }, { label: 'Fontes' }]);
  useNewsWatch();

  const feeds = state.feeds;
  const failing = ready ? feeds.filter((feed) => feed.state === 'failing') : [];
  const filterCount = Number(tierFilter !== 'all') + Number(relevanceFilter !== 'all');
  const visibleFeeds = feeds.filter((feed) => {
    const rateable = isRateableNewsSource(feed);
    const tier = rateable ? feed.rating?.tier ?? 'unrated' : 'aggregator';
    return (tierFilter === 'all' || tier === tierFilter)
      && (relevanceFilter === 'all' || (rateable && feed.rating?.relevance === relevanceFilter));
  });
  if (order === 'strength') visibleFeeds.sort((a, b) => sourceRatingRank(isRateableNewsSource(a) ? a.rating : undefined) - sourceRatingRank(isRateableNewsSource(b) ? b.rating : undefined));
  const ratingFeed = rating ? feeds.find((feed) => feed.id === rating.id) : undefined;
  const clearFilters = () => { setTierFilter('all'); setRelevanceFilter('all'); };

  async function retry(feed: NewsFeed) {
    toast(`Lendo ${feed.name} de novo`);
    const read = await actions.retryFeed(feed.id);
    if (read?.state === 'failing') toast(`${feed.name} não respondeu`, { tone: 'error', description: read.lastError });
  }

  async function change(feed: NewsFeed, patch: { paused?: boolean; everyMinutes?: number }, done?: string) {
    const result = await actions.updateFeed(feed.id, patch);
    if (!result.ok) toast('Não foi possível salvar', { tone: 'error', description: result.message });
    else if (done) toast(done);
  }


  const active = feeds.filter((feed) => feed.state === 'active').length;
  const today = feeds.reduce((total, feed) => total + feed.lastDay, 0);
  const rhythm = feeds.reduce<number[]>((days, feed) => (feed.lastWeek ?? []).map((value, index) => (days[index] ?? 0) + value), []);
  const duplicates = state.news.reduce((total, item) => total + item.duplicates.length, 0);
  const lastRead = feeds.map((feed) => feed.lastReadAt ?? '').sort().pop();

  async function refresh() {
    setRefreshing(true);
    try { await actions.refreshNews(); } finally { setRefreshing(false); }
  }

  return (
    <>
      <PageStack>
        <PageHeader
          title="Fontes"
          actions={canEdit ? <>
            {live && feeds.length > 0 ? <Button variant="secondary" icon={Rss} onClick={() => setDiscovering(true)}>Descobrir fontes</Button> : null}
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Adicionar fonte</Button>
          </> : undefined}
        />
        {live && newsFailed ? (
          <EmptyState icon={AlertTriangle} title="Não foi possível carregar as fontes" description="Tente novamente para ver as fontes cadastradas."
            actions={<Button variant="primary" loading={refreshing} onClick={() => void refresh()}>Tentar novamente</Button>} />
        ) : ready && feeds.length === 0 ? (
          <EmptyState
            icon={Rss}
            title="Nenhuma fonte cadastrada"
            description={canEdit && live ? 'Encontre fontes para o seu veículo ou setor e receba as primeiras notícias.' : undefined}
            actions={canEdit ? <>
              {live ? <Button variant="primary" icon={Rss} onClick={() => setDiscovering(true)}>Descobrir fontes</Button> : null}
              <Button variant={live ? 'secondary' : 'primary'} icon={Plus} onClick={() => setAdding(true)}>Adicionar fonte</Button>
            </> : undefined}
          />
        ) : (
          <>
            <MetricStrip
              label="Leitura das fontes"
              items={[
                { label: 'Feeds ativos', value: ready ? `${active} de ${feeds.length}` : undefined, loading: !ready, ...(failing.length ? { hint: failing.length === 1 ? '1 com falha' : `${failing.length} com falha`, warn: true } : {}) },
                { label: 'Notícias em 24 h', value: ready ? String(today) : undefined, loading: !ready, ...(rhythm.length > 1 ? { sparkline: { points: rhythm, label: 'Notícias por dia, 7 dias' } } : {}) },
                { label: 'Duplicatas agrupadas', value: ready ? String(duplicates) : undefined, loading: !ready, hint: 'A mesma notícia em outro veículo' },
                { label: 'Última leitura', value: ready && lastRead ? <RelativeTime at={lastRead} /> : '—', loading: !ready },
              ]}
            />
            <FilterBar filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} filterCount={filterCount} bandId="source-rating-filters"
              actions={<Select label="Ordenar fontes" size="sm" value={order} onChange={setOrder} options={[
                { value: 'current', label: 'Ordem atual' }, { value: 'strength', label: 'Força editorial' },
              ]} />} />
            <FilterBand id="source-rating-filters" open={filtersOpen} onClear={filterCount ? clearFilters : undefined}>
              <FilterField><Field label="Força editorial">
                {({ id }) => <Select id={id} size="sm" value={tierFilter} onChange={setTierFilter} options={[
                  { value: 'all', label: 'Todas' },
                  ...Object.entries(SOURCE_TIER_LABELS).map(([value, label]) => ({ value, label: `${value} · ${label}` })),
                  { value: 'unrated', label: 'Não avaliadas' }, { value: 'aggregator', label: 'Agregadores' },
                ]} />}
              </Field></FilterField>
              <FilterField><Field label="Relevância para o veículo">
                {({ id }) => <Select id={id} size="sm" value={relevanceFilter} onChange={setRelevanceFilter} options={[
                  { value: 'all', label: 'Todas' }, ...Object.entries(SOURCE_RELEVANCE_LABELS).map(([value, label]) => ({ value, label })),
                ]} />}
              </Field></FilterField>
            </FilterBand>
            {ready && visibleFeeds.length === 0 ? <EmptyState title="Nenhuma fonte neste filtro" actions={<Button variant="secondary" onClick={clearFilters}>Limpar filtros</Button>} /> : null}
            <Grid columns="1:1:1" collapseBelow={1024} as="ul">
              {visibleFeeds.map((feed) => (
                <FeedCard
                  key={feed.id}
                  feed={feed}
                  canEdit={canEdit}
                  onRetry={() => void retry(feed)}
                  onPause={(paused) => void change(feed, { paused }, paused ? `${feed.name} pausada` : `${feed.name} retomada`)}
                  onRemove={() => setRemoving(feed)}
                  onInterval={(everyMinutes) => void change(feed, { everyMinutes })}
                  onRating={(mode) => setRating({ id: feed.id, mode })}
                />
              ))}
            </Grid>
          </>
        )}
      </PageStack>
      <AddFeedDialog open={adding} onClose={() => setAdding(false)} />
      {discovering ? <DiscoverSourcesDialog open onClose={() => setDiscovering(false)} /> : null}
      {rating && ratingFeed ? <SourceRatingDialog key={`${rating.id}:${rating.mode}`} feed={ratingFeed} mode={rating.mode} onClose={() => setRating(undefined)} /> : null}
      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={`Remover ${removing?.name ?? 'fonte'}?`}
        description="As notícias já importadas continuam na fila."
        confirmLabel="Remover fonte"
        tone="danger"
        onConfirm={async () => {
          if (removing) {
            const result = await actions.removeFeed(removing.id);
            if (result.ok) toast('Fonte removida', { description: removing.name });
            else toast('Não foi possível remover', { tone: 'error', description: result.message });
          }
          setRemoving(undefined);
        }}
      />
    </>
  );
}

/** One source: its mark, how it is doing, its last 7 days, how often the desk reads it. */
function FeedCard({ feed, canEdit, onRetry, onPause, onRemove, onInterval, onRating }: {
  feed: NewsFeed;
  canEdit: boolean;
  onRetry: () => void;
  onPause: (paused: boolean) => void;
  onRemove: () => void;
  onInterval: (minutes: number) => void;
  onRating: (mode: 'view' | 'edit') => void;
}) {
  const state = FEED_STATE[feed.state];
  const rateable = isRateableNewsSource(feed);
  const card = (
    <Card padding="md" as="div">
      <PageStack>
        <CardHeader
          titleAs="h2"
          leading={<BrandMark name={feed.name} src={newsLogoUrl(feed.site ?? feed.url)} size="md" />}
          title={feed.name}
          badge={<Badge variant="soft" size="sm" tone={state.tone} dot={feed.state === 'paused' ? 'hollow' : true}>{state.label}</Badge>}
          description={feedOrigin(feed)}
          actions={canEdit ? (
            <Menu
              label={`Ações de ${feed.name}`}
              align="end"
              sections={[{
                items: [
                  ...(rateable ? [{ label: feed.rating ? 'Editar avaliação' : 'Avaliar fonte', onSelect: () => onRating('edit') }] : []),
                  feed.state === 'failing'
                    ? { label: 'Tentar de novo', icon: RefreshCw, onSelect: onRetry }
                    : feed.state === 'paused'
                      ? { label: 'Retomar', icon: Play, onSelect: () => onPause(false) }
                      : { label: 'Pausar', icon: Pause, onSelect: () => onPause(true) },
                  { label: 'Remover', icon: Trash2, danger: true, onSelect: onRemove },
                ],
              }]}
              trigger={(props) => <IconButton {...props} label={`Ações de ${feed.name}`} icon={Ellipsis} variant="ghost" size="sm" />}
            />
          ) : undefined}
        />
        {rateable ? <MetaList size="sm" items={[
          <SourceRatingBadge key="rating" rating={feed.rating} relevance />,
          ...(feed.rating || canEdit ? [<LinkButton key="view" size="sm" onClick={() => onRating(feed.rating ? 'view' : 'edit')}>{feed.rating ? 'Ver avaliação' : 'Avaliar fonte'}</LinkButton>] : []),
        ]} /> : <Badge variant="soft" size="sm" tone="gray">Agregador</Badge>}
        {feed.lastWeek && feed.lastWeek.length > 1 ? (
          <Sparkline points={feed.lastWeek} tone={feed.state === 'failing' ? 'red' : feed.state === 'paused' ? 'gray' : 'blue'} fluid height={40} />
        ) : null}
        <MetaList
          size="sm"
          items={[
            `${feed.lastDay} em 24 h`,
            feed.lastReadAt ? <RelativeTime key="read" at={feed.lastReadAt} /> : 'Ainda não lida',
          ]}
        />
        <Select
          size="sm"
          label={`Frequência de ${feed.name}`}
          value={String(feed.everyMinutes)}
          options={INTERVAL_OPTIONS}
          disabled={!canEdit || feed.state === 'paused'}
          onChange={(value) => onInterval(Number(value))}
        />
      </PageStack>
    </Card>
  );
  if (feed.state !== 'failing') return card;
  return (
    <AttachedNote
      tone="red"
      icon={AlertTriangle}
      note={<>{feed.lastError ?? 'Não responde.'} {canEdit ? <LinkButton size="sm" tone="inherit" onClick={onRetry}>Tentar de novo</LinkButton> : null}</>}
    >
      {card}
    </AttachedNote>
  );
}
