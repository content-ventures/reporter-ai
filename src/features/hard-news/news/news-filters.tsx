'use client';

import { ActiveFilters, Field, FilterBand, FilterBar, FilterField, SearchField, Select, Tabs } from '@content-ventures/design-system/v3';
import type { ActiveFilter } from '@content-ventures/design-system/v3';
import { CLIPPING_SEGMENTS, CLIPPING_WINDOWS } from '@/domain/news-clipping';
import type { ClippingSegment, ClippingWindow } from '@/domain/news-clipping';
import type { NewsFeed } from '@/domain/hard-news';
import type { SourceTierFilter } from '@/domain/news-source-match';
import { SOURCE_TIER_LABELS } from '@/domain/news-source-rating';
import { DESK_TABS, type DeskTab } from './news-model';

export function NewsFilters({ tab, onTab, counts, query, onQuery, open, onOpen, tier, onTier, source, onSource, feeds, clipping }: {
  tab: DeskTab; onTab: (tab: DeskTab) => void; counts?: { open: number; decided: number };
  query: string; onQuery: (query: string) => void; open: boolean; onOpen: (open: boolean) => void;
  tier: SourceTierFilter; onTier: (tier: SourceTierFilter) => void;
  source: string; onSource: (source: string) => void; feeds: readonly NewsFeed[];
  clipping?: { period: ClippingWindow; onPeriod: (value: ClippingWindow) => void;
    segment: ClippingSegment | 'all'; onSegment: (value: ClippingSegment | 'all') => void };
}) {
  const applied: ActiveFilter[] = [];
  if (tier !== 'all') applied.push({ id: 'tier', label: 'Força', value: tier === 'unrated' ? 'Não avaliadas' : tier,
    onRemove: () => onTier('all'), onEdit: () => onOpen(true) });
  if (source !== 'all') applied.push({ id: 'source', label: 'Fonte', value: feeds.find(feed => feed.id === source)?.name ?? 'Fonte removida',
    onRemove: () => onSource('all'), onEdit: () => onOpen(true) });
  if (clipping?.segment && clipping.segment !== 'all') applied.push({ id: 'segment', label: 'Segmento',
    value: CLIPPING_SEGMENTS.find(segment => segment.id === clipping.segment)!.label, onRemove: () => clipping.onSegment('all'), onEdit: () => onOpen(true) });
  if (clipping && clipping.period !== 24) applied.push({ id: 'period', label: 'Período',
    value: CLIPPING_WINDOWS.find(window => window.value === clipping.period)!.label, onRemove: () => clipping.onPeriod(24), onEdit: () => onOpen(true) });
  const clear = () => { onTier('all'); onSource('all'); clipping?.onPeriod(24); clipping?.onSegment('all'); };
  return <>
    <FilterBar
      tabs={<Tabs<DeskTab> label="Situação" size="sm" value={tab} onChange={onTab}
        items={DESK_TABS.map(entry => ({ ...entry, count: counts?.[entry.value] }))} />}
      search={<SearchField label="Buscar notícias" value={query} onValueChange={onQuery} placeholder="Buscar notícia ou fonte" size="sm" />}
      filtersOpen={open} onFiltersOpenChange={onOpen} filterCount={applied.length} bandId="news-filters"
    />
    <FilterBand id="news-filters" open={open} onClear={applied.length ? clear : undefined}>
      {clipping ? <>
        <FilterField><Field label="Período">
          {({ id }) => <Select id={id} size="sm" value={String(clipping.period)} onChange={value => clipping.onPeriod(Number(value) as ClippingWindow)}
            options={CLIPPING_WINDOWS.map(window => ({ value: String(window.value), label: window.label }))} />}
        </Field></FilterField>
        <FilterField><Field label="Segmento">
          {({ id }) => <Select id={id} size="sm" value={clipping.segment} onChange={value => clipping.onSegment(value as ClippingSegment | 'all')}
            options={[{ value: 'all', label: 'Todos os segmentos' }, ...CLIPPING_SEGMENTS.map(segment => ({ value: segment.id, label: segment.label }))]} />}
        </Field></FilterField>
      </> : null}
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
    {!open && applied.length ? <ActiveFilters filters={applied} onClearAll={clear} max={4} /> : null}
  </>;
}
