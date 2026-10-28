'use client';
import { useState } from 'react';
import { Button, ButtonGroup, Checkbox, Field, FieldGroup, Input, Section, Select } from '@content-ventures/design-system/v3';
import type { MemoryQuery } from '@/domain/editorial-memory';
import { VERDICT_LABELS } from '@/domain/fact-check';
import { usePeople } from '@/state';
import { MATERIAL_KINDS } from './memory-materials';

export function MemoryFilters({ applied, onApply }: { applied: MemoryQuery; onApply: (query: MemoryQuery) => void }) {
  const [draft, setDraft] = useState(applied), [topicsText, setTopicsText] = useState(applied.topics?.join(', ') ?? ''), people = usePeople();
  const update = <K extends keyof MemoryQuery>(key: K, value: MemoryQuery[K]) => setDraft(current => ({ ...current, [key]: value }));
  return <Section variant="band">
    <FieldGroup label="Filtros" columns={3}>
      <Field label="Pessoa">{({ id }) => <Select id={id} value={draft.personId ?? ''} searchable options={[{ value: '', label: 'Todas' }, ...(people.data ?? []).map(person => ({ value: person.id, label: person.name }))]} onChange={value => update('personId', value || undefined)} />}</Field>
      <Field label="Tipo de material">{({ id }) => <Select id={id} value={draft.materialKind ?? ''} options={[{ value: '', label: 'Todos' }, ...MATERIAL_KINDS]} onChange={value => update('materialKind', (value || undefined) as MemoryQuery['materialKind'])} />}</Field>
      <Field label="Veredito">{({ id }) => <Select id={id} value={draft.verdict ?? ''} options={[{ value: '', label: 'Todos' }, ...Object.entries(VERDICT_LABELS).map(([value, label]) => ({ value, label }))]} onChange={value => update('verdict', (value || undefined) as MemoryQuery['verdict'])} />}</Field>
      {([{ key: 'institution', label: 'Instituição' }, { key: 'company', label: 'Empresa' }, { key: 'event', label: 'Evento' }, { key: 'edition', label: 'Edição' }] as const).map(field => <Field key={field.key} label={field.label}>{({ id }) => <Input id={id} value={draft[field.key] ?? ''} onChange={event => update(field.key, event.target.value || undefined)} />}</Field>)}
      <Field label="Temas separados por vírgula">{({ id }) => <Input id={id} value={topicsText} onChange={event => { setTopicsText(event.target.value); update('topics', event.target.value ? event.target.value.split(',').map(topic => topic.trim()).filter(Boolean) : undefined); }} />}</Field>
      <Field label="Confiança factual mínima">{({ id }) => <Input id={id} type="number" min={0} max={100} value={draft.minConfidence ?? ''} onChange={event => update('minConfidence', event.target.value ? Number(event.target.value) : undefined)} />}</Field>
      <Field label="Qual data filtrar">{({ id }) => <Select id={id} value={draft.dateField ?? ''} options={[{ value: '', label: 'Sem período' }, { value: 'recorded', label: 'Data da fala' }, { value: 'published', label: 'Publicação do material' }, { value: 'observation', label: 'Importação no banco' }]} onChange={value => setDraft(current => ({ ...current, dateField: (value || undefined) as MemoryQuery['dateField'], ...(!value ? { from: undefined, to: undefined } : {}) }))} />}</Field>
      <Field label="De">{({ id }) => <Input id={id} type="date" disabled={!draft.dateField} value={draft.from ?? ''} onChange={event => update('from', event.target.value || undefined)} />}</Field>
      <Field label="Até">{({ id }) => <Input id={id} type="date" disabled={!draft.dateField} value={draft.to ?? ''} onChange={event => update('to', event.target.value || undefined)} />}</Field>
      <Field label="Estado do registro">{({ id }) => <Select id={id} value={draft.status ?? 'active'} options={[{ value: 'active', label: 'Ativas' }, { value: 'withdrawn', label: 'Retiradas' }, { value: 'superseded', label: 'Substituídas' }, { value: 'all', label: 'Todos' }]} onChange={value => update('status', value as MemoryQuery['status'])} />}</Field>
      <Field label="Estágio de uso">{({ id }) => <Select id={id} value={draft.useStage ?? 'inserted'} options={[{ value: 'inserted', label: 'Inseridas em artigos' }, { value: 'approved', label: 'Em artigos aprovados' }, { value: 'published', label: 'Em publicações' }]} onChange={value => update('useStage', value as MemoryQuery['useStage'])} />}</Field>
      <Checkbox label="Somente evidências não usadas neste estágio" checked={draft.unused ?? false} onChange={event => update('unused', event.target.checked || undefined)} />
    </FieldGroup>
    <ButtonGroup label="Aplicar filtros"><Button disabled={Boolean(draft.from && draft.to && draft.from > draft.to)} onClick={() => onApply(draft)}>Aplicar filtros</Button><Button variant="secondary" onClick={() => { setDraft({}); onApply({}); }}>Limpar filtros</Button></ButtonGroup>
  </Section>;
}
