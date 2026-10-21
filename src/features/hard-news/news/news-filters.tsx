'use client';

import { ActiveFilters, Field, FilterBand, FilterBar, FilterField, SearchField, Select, Tabs } from '@content-ventures/design-system/v3';
import type { ActiveFilter } from '@content-ventures/design-system/v3';
import type { NewsFeed } from '@/domain/hard-news';
import type { SourceTierFilter } from '@/domain/news-source-match';
import { SOURCE_TIER_LABELS } from '@/domain/news-source-rating';
import { DESK_TABS, type DeskTab } from './news-model';

export function NewsFilters({ tab, onTab, counts, query, onQuery, open, onOpen, tier, onTier, source, onSource, feeds }: {
  tab: DeskTab; onTab: (tab: DeskTab) => void; counts?: { open: number; decided: number };
  query: string; onQuery: (query: string) => void; open: boolean; onOpen: (open: boolean) => void;
  tier: SourceTierFilter; onTier: (tier: SourceTierFilter) => void;
  source: string; onSource: (source: string) => void; feeds: readonly NewsFeed[];
}) {
  const applied: ActiveFilter[] = [];
  if (tier !== 'all') applied.push({ id: 'tier', label: 'Força', value: tier === 'unrated' ? 'Não avaliadas' : tier,
    onRemove: () => onTier('all'), onEdit: () => onOpen(true) });
  if (source !== 'all') applied.push({ id: 'source', label: 'Fonte', value: feeds.find(feed => feed.id === source)?.name ?? 'Fonte removida',
    onRemove: () => onSource('all'), onEdit: () => onOpen(true) });
  const clear = () => { onTier('all'); onSource('all'); };
  return <>
    <Tabs<DeskTab> label="Situação" size="sm" value={tab} onChange={onTab}
      items={DESK_TABS.map(entry => ({ ...entry, count: counts?.[entry.value] }))} />
    <FilterBar
      search={<SearchField label="Buscar notícias" value={query} onValueChange={onQuery} placeholder="Buscar notícia ou fonte" size="sm" />}
      filtersOpen={open} onFiltersOpenChange={onOpen} filterCount={applied.length} bandId="news-filters"
    />
    <FilterBand id="news-filters" open={open} onClear={applied.length ? clear : undefined}>
      <FilterField><Field label="Fonte">
        {({ id }) => <Select id={id} size="sm" value={source} onChange={onSource} options={[
          { value: 'all', label: 'Todas as fontes' }, ...feeds.map(feed => ({ value: feed.id, label: feed.name })),
        ]} />}
      </Field></FilterField>
      <FilterField><Field label="Força editorial da fonte">
        {({ id }) => <Select id={id} size="sm" value={tier} onChange={value => onTier(value as SourceTierFilter)} options={[
          { value: 'all', label: 'Todas as classificações' },
          ...Object.entries(SOURCE_TIER_LABELS).map(([value, label]) => ({ value, label: `${value} · ${label}` })),
          { value: 'unrated', label: 'Não avaliadas' },
        ]} />}
      </Field></FilterField>
    </FilterBand>
    {!open && applied.length ? <ActiveFilters filters={applied} onClearAll={clear} max={2} /> : null}
  </>;
}
