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
import { AUDIT_RESULT_LABELS, AUDIT_RESULTS, AUDIT_TYPE_LABELS, AUDIT_TYPES } from '@/domain';
import type { PersonSummary } from '@/ports';
import { localDay, periodLabel } from '@/ui/days';
import { useNow } from '@/ui/time';
import { CLEARED_AUDIT_FILTERS, type AuditParams } from './audit-params';
import type { SetAuditParams } from './use-audit-params';

/**
 * "Filtros" of the Logs (F1.7): Período, Pessoa, Tipo and Resultado, applied as they are picked
 * (no "Aplicar", same as Produções), and the chips that stand for them while the band is closed.
 */

export const AUDIT_FILTER_BAND_ID = 'audit-filters';

function presetsFor(now: Date | undefined): DatePreset[] | undefined {
  if (!now) return undefined;
  const today = localDay(now);
  return [
    { label: 'Hoje', start: today, end: today },
    { label: 'Últimos 7 dias', start: localDay(now, 6), end: today },
    { label: 'Últimos 30 dias', start: localDay(now, 29), end: today },
  ];
}

function hasFilters(params: AuditParams): boolean {
  return Boolean(params.from || params.to || params.person || params.type || params.result);
}

export type AuditFilterBandProps = {
  open: boolean;
  params: AuditParams;
  setParams: SetAuditParams;
  /** Everyone in the trail, by name. */
  people: PersonSummary[];
  viewerId?: string;
};

export function AuditFilterBand({ open, params, setParams, people, viewerId }: AuditFilterBandProps) {
  const now = useNow();
  const personOptions: SelectOption[] = [
    { value: '', label: 'Todas as pessoas' },
    ...people.map((person) => {
      const option: SelectOption = { value: person.id, label: person.name, leading: <Avatar name={person.name} src={person.avatarUrl} size="xs" decorative /> };
      if (person.id === viewerId) option.description = 'Você';
      return option;
    }),
  ];
  const typeOptions: SelectOption[] = [{ value: '', label: 'Todos os tipos' }, ...AUDIT_TYPES.map((type) => ({ value: type, label: AUDIT_TYPE_LABELS[type] }))];
  const resultOptions: SelectOption[] = [
    { value: '', label: 'Todos os resultados' },
    ...AUDIT_RESULTS.map((result) => ({ value: result, label: AUDIT_RESULT_LABELS[result] })),
  ];

  return (
    <FilterBand id={AUDIT_FILTER_BAND_ID} open={open} label="Filtros dos logs" onClear={hasFilters(params) ? () => setParams(CLEARED_AUDIT_FILTERS) : undefined}>
      <FilterField wide>
        <DateRangePicker
          size="sm"
          aria-label="Período"
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
      <FilterField>
        <Select
          size="sm"
          label="Pessoa"
          value={params.person ?? ''}
          placeholder="Todas as pessoas"
          options={personOptions}
          onChange={(value) => setParams({ person: value || null })}
        />
      </FilterField>
      <FilterField>
        <Select
          size="sm"
          label="Tipo"
          value={params.type ?? ''}
          placeholder="Todos os tipos"
          options={typeOptions}
          onChange={(value) => setParams({ type: AUDIT_TYPES.find((type) => type === value) ?? null })}
        />
      </FilterField>
      <FilterField>
        <Select
          size="sm"
          label="Resultado"
          value={params.result ?? ''}
          placeholder="Todos os resultados"
          options={resultOptions}
          onChange={(value) => setParams({ result: AUDIT_RESULTS.find((result) => result === value) ?? null })}
        />
      </FilterField>
    </FilterBand>
  );
}

export type AuditActiveFiltersProps = {
  params: AuditParams;
  setParams: SetAuditParams;
  people: PersonSummary[];
  onEdit: () => void;
  /** "42 eventos": what the filters leave. */
  summary?: string;
};

export function auditActiveFilters({ params, setParams, people, onEdit }: Omit<AuditActiveFiltersProps, 'summary'>): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (params.from || params.to) {
    filters.push({ id: 'period', label: 'Período', value: periodLabel(params.from, params.to), onRemove: () => setParams({ from: null, to: null }), onEdit });
  }
  if (params.person) {
    const person = people.find((candidate) => candidate.id === params.person);
    const name = person?.name ?? (params.person === 'system' ? 'Sistema' : 'Pessoa');
    filters.push({
      id: 'person',
      label: 'Pessoa',
      value: name,
      leading: <Avatar name={name} src={person?.avatarUrl} size="xs" decorative />,
      onRemove: () => setParams({ person: null }),
      onEdit,
    });
  }
  if (params.type) {
    filters.push({ id: 'type', label: 'Tipo', value: AUDIT_TYPE_LABELS[params.type], onRemove: () => setParams({ type: null }), onEdit });
  }
  if (params.result) {
    filters.push({ id: 'result', label: 'Resultado', value: AUDIT_RESULT_LABELS[params.result], onRemove: () => setParams({ result: null }), onEdit });
  }
  return filters;
}

export function AuditActiveFilters({ summary, ...props }: AuditActiveFiltersProps) {
  const filters = auditActiveFilters(props);
  if (filters.length === 0) return null;
  return (
    <ActiveFilters filters={filters} onClearAll={() => props.setParams(CLEARED_AUDIT_FILTERS)}>
      {summary}
    </ActiveFilters>
  );
}
