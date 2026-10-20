'use client';

import { ActiveFilters, FilterBand, FilterField, Select, type ActiveFilter } from '@content-ventures/design-system/v3';
import { CITATION_VERDICTS, CLAIM_KIND_LABELS, CLAIM_KINDS, VERDICT_LABELS } from '@/domain/fact-check';
import type { CitationVerdict, ClaimKind } from '@/domain/fact-check';
import { NO_FILTERS, type QuoteFilters } from './quote-model';

export const QUOTE_FILTER_BAND_ID = 'quote-filters';

const AUTHORSHIP = { confirmed: 'Conferida', pending: 'A conferir' } as const;

export function filterCount(filters: QuoteFilters): number {
  return Object.values(filters).filter(Boolean).length;
}

type Props = { filters: QuoteFilters; onChange: (next: QuoteFilters) => void; authors: string[]; sources: string[] };

/** Tipo de afirmação, Veredito, Pessoa, Fonte and Autoria, applied as they are picked. */
export function QuoteFilterBand({ open, filters, onChange, authors, sources }: Props & { open: boolean }) {
  const patch = (next: Partial<QuoteFilters>) => onChange({ ...filters, ...next });
  return (
    <FilterBand id={QUOTE_FILTER_BAND_ID} open={open} label="Filtros das citações" onClear={filterCount(filters) ? () => onChange(NO_FILTERS) : undefined}>
      <FilterField>
        <Select size="sm" aria-label="Tipo de afirmação" value={filters.kind} onChange={(kind) => patch({ kind: kind as ClaimKind | '' })}
          options={[{ value: '', label: 'Todos os tipos' }, ...CLAIM_KINDS.map((kind) => ({ value: kind, label: CLAIM_KIND_LABELS[kind] }))]} />
      </FilterField>
      <FilterField>
        <Select size="sm" aria-label="Veredito" value={filters.verdict} onChange={(verdict) => patch({ verdict: verdict as CitationVerdict | '' })}
          options={[{ value: '', label: 'Todos os vereditos' }, ...CITATION_VERDICTS.map((verdict) => ({ value: verdict, label: VERDICT_LABELS[verdict] }))]} />
      </FilterField>
      <FilterField>
        <Select size="sm" aria-label="Pessoa" value={filters.author} onChange={(author) => patch({ author })}
          options={[{ value: '', label: 'Todas as pessoas' }, ...authors.map((author) => ({ value: author, label: author }))]} />
      </FilterField>
      <FilterField>
        <Select size="sm" aria-label="Fonte" value={filters.source} onChange={(source) => patch({ source })}
          options={[{ value: '', label: 'Todas as fontes' }, ...sources.map((source) => ({ value: source, label: source }))]} />
      </FilterField>
      <FilterField>
        <Select size="sm" aria-label="Autoria" value={filters.authorship} onChange={(authorship) => patch({ authorship: authorship as QuoteFilters['authorship'] })}
          options={[{ value: '', label: 'Toda autoria' }, { value: 'confirmed', label: 'Autoria conferida' }, { value: 'pending', label: 'Autoria a conferir' }]} />
      </FilterField>
    </FilterBand>
  );
}

/** The chips of the applied filters while the band is closed. */
export function QuoteActiveFilters({ filters, onChange, onEdit }: Omit<Props, 'authors' | 'sources'> & { onEdit: () => void }) {
  const chips: ActiveFilter[] = [];
  const add = (id: keyof QuoteFilters, label: string, value: string) => chips.push({ id, label, value, onRemove: () => onChange({ ...filters, [id]: '' }), onEdit });
  if (filters.kind) add('kind', 'Tipo', CLAIM_KIND_LABELS[filters.kind]);
  if (filters.verdict) add('verdict', 'Veredito', VERDICT_LABELS[filters.verdict]);
  if (filters.author) add('author', 'Pessoa', filters.author);
  if (filters.source) add('source', 'Fonte', filters.source);
  if (filters.authorship) add('authorship', 'Autoria', AUTHORSHIP[filters.authorship]);
  return <ActiveFilters filters={chips} onClearAll={() => onChange(NO_FILTERS)} />;
}
