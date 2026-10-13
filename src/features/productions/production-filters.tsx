'use client';

import {
  ActiveFilters,
  Avatar,
  DateRangePicker,
  FilterBand,
  FilterField,
  Select,
  type ActiveFilter,
  type DatePreset,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import type { PersonSummary } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { useNow } from '@/ui/time';
import { LIST_ORIGINS, localDay, periodLabel, type ListParams } from './list-params';
import type { SetListParams } from './use-list-params';

/**
 * "Filtros" of the list (PLAN §3.2): Responsável, Origem and Período, applied as they are
 * picked (no "Aplicar"), and the chips that stand for them while the band is closed.
 */

export const FILTER_BAND_ID = 'productions-filters';

type Owner = Pick<PersonSummary, 'id' | 'name' | 'avatarUrl'>;

function presetsFor(now: Date | undefined): DatePreset[] | undefined {
  if (!now) return undefined;
  const today = localDay(now);
  return [
    { label: 'Hoje', start: today, end: today },
    { label: 'Últimos 7 dias', start: localDay(now, 6), end: today },
    { label: 'Últimos 30 dias', start: localDay(now, 29), end: today },
  ];
}

export type ProductionFiltersProps = {
  open: boolean;
  params: ListParams;
  setParams: SetListParams;
  owners: Owner[];
  /** The person using the product: first in "Responsável", marked "Você". */
  viewerId?: string;
};

export function ProductionFilterBand({ open, params, setParams, owners, viewerId }: ProductionFiltersProps) {
  const now = useNow();
  const ownerOptions: SelectOption[] = [
    { value: '', label: 'Todos os responsáveis' },
    ...[...owners]
      .sort((a, b) => Number(b.id === viewerId) - Number(a.id === viewerId) || a.name.localeCompare(b.name, 'pt-BR'))
      .map((owner) => {
        const option: SelectOption = {
          value: owner.id,
          label: owner.name,
          leading: <Avatar name={owner.name} src={owner.avatarUrl} size="xs" decorative />,
        };
        if (owner.id === viewerId) option.description = 'Você';
        return option;
      }),
  ];
  const originOptions: SelectOption[] = [
    { value: '', label: 'Todas as origens' },
    ...LIST_ORIGINS.map((origin) => ({ value: origin, label: SOURCE_ORIGIN_LABELS[origin] })),
  ];
  const filtered = Boolean(params.owner || params.origin || params.from || params.to);

  return (
    <FilterBand
      id={FILTER_BAND_ID}
      open={open}
      label="Filtros das produções"
      onClear={filtered ? () => setParams({ owner: null, origin: null, from: null, to: null }) : undefined}
    >
      <FilterField>
        <Select
          size="sm"
          label="Responsável"
          value={params.owner ?? ''}
          placeholder="Todos os responsáveis"
          options={ownerOptions}
          onChange={(value) => setParams({ owner: value || null })}
        />
      </FilterField>
      <FilterField>
        <Select
          size="sm"
          label="Origem"
          value={params.origin ?? ''}
          placeholder="Todas as origens"
          options={originOptions}
          onChange={(value) => setParams({ origin: LIST_ORIGINS.find((origin) => origin === value) ?? null })}
        />
      </FilterField>
      <FilterField wide>
        <DateRangePicker
          size="sm"
          aria-label="Atualizada no período"
          placeholder="Qualquer período"
          clearable
          duration={false}
          start={params.from ?? ''}
          end={params.to ?? ''}
          max={now ? localDay(now) : undefined}
          presets={presetsFor(now)}
          onChange={(range) => setParams({ from: range.start || null, to: range.end || null })}
        />
      </FilterField>
    </FilterBand>
  );
}

export type ProductionActiveFiltersProps = {
  params: ListParams;
  setParams: SetListParams;
  owners: Owner[];
  onEdit: () => void;
  /** "3 produções": what the filters leave. */
  summary?: string;
};

export function productionActiveFilters({ params, setParams, owners, onEdit }: Omit<ProductionActiveFiltersProps, 'summary'>): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (params.owner) {
    const owner = owners.find((person) => person.id === params.owner);
    const name = owner?.name ?? 'Pessoa';
    filters.push({
      id: 'owner',
      label: 'Responsável',
      value: name,
      leading: <Avatar name={name} src={owner?.avatarUrl} size="xs" decorative />,
      onRemove: () => setParams({ owner: null }),
      onEdit,
    });
  }
  if (params.origin) {
    filters.push({
      id: 'origin',
      label: 'Origem',
      value: SOURCE_ORIGIN_LABELS[params.origin],
      onRemove: () => setParams({ origin: null }),
      onEdit,
    });
  }
  if (params.from || params.to) {
    filters.push({
      id: 'period',
      label: 'Período',
      value: periodLabel(params.from, params.to),
      onRemove: () => setParams({ from: null, to: null }),
      onEdit,
    });
  }
  return filters;
}

export function ProductionActiveFilters({ summary, ...props }: ProductionActiveFiltersProps) {
  const filters = productionActiveFilters(props);
  if (filters.length === 0) return null;
  return (
    <ActiveFilters filters={filters} onClearAll={() => props.setParams({ owner: null, origin: null, from: null, to: null })}>
      {summary}
    </ActiveFilters>
  );
}
