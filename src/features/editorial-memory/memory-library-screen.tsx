'use client';
import { useCallback, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, DataTable, EmptyState, ErrorState, FilterBar, PageHeader, PageStack, SearchField, Section, Select, Spinner, Tabs, toast } from '@content-ventures/design-system/v3';
import { Plus, RotateCw } from '@content-ventures/design-system/v3/icons';
import type { MemoryEvidenceRef, MemoryMaterial, MemoryQuery } from '@/domain/editorial-memory';
import { memoryEvidenceRef } from '@/domain/editorial-memory';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, usePeople } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { ELIGIBILITY_LABELS, MemoryEvidenceDrawer } from './memory-evidence-detail';
import { MemoryFilters } from './memory-filters';
import { MemoryImportDialog, MemoryMaterialDrawer, MemoryMaterials } from './memory-materials';

type Tab = 'all' | 'citation' | 'statistic' | 'materials';
export function MemoryLibraryScreen() {
  const [tab, setTab] = useState<Tab>('all'), [query, setQuery] = useState(''), [sort, setSort] = useState<MemoryQuery['sort']>('newest');
  const [filters, setFilters] = useState<MemoryQuery>({}), [filtersOpen, setFiltersOpen] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors.at(-1);
  const [material, setMaterial] = useState<MemoryMaterial>(), [materialId, setMaterialId] = useState<string>(), [evidenceId, setEvidenceId] = useState<string>(), [importing, setImporting] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false), [evidenceOpen, setEvidenceOpen] = useState(false);
  const [selected, setSelected] = useState<MemoryEvidenceRef[]>([]), [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const people = usePeople(), canEdit = useCan('library.edit');
  const load = useCallback((port: MemoryLibrary) => port.query({ ...filters, ...(tab === 'citation' || tab === 'statistic' ? { kind: tab } : {}), query, sort, materialId: material?.id, cursor, limit: 25 }), [tab, query, sort, material?.id, cursor, filters]);
  const resource = useMemoryResource(load), page = resource.data;
  const reset = () => { setCursors([undefined]); resource.reload(); };
  return <PageStack>
    <PageHeader title="Banco de citações e estatísticas" actions={<>{canEdit && <Button icon={Plus} onClick={() => setImporting(true)}>Importar material</Button>}<Button variant="secondary" icon={RotateCw} onClick={reset}>Atualizar</Button></>} />
    <FilterBar filtersOpen={filtersOpen} onFiltersOpenChange={setFiltersOpen} filterCount={Object.values(filters).filter(value => value !== undefined).length} tabs={<Tabs label="Conteúdo do banco" value={tab} onChange={value => { setTab(value); setCursors([undefined]); }} items={[{ value: 'all', label: 'Todas' }, { value: 'citation', label: 'Citações' }, { value: 'statistic', label: 'Estatísticas' }, { value: 'materials', label: 'Materiais' }]} />}
      search={tab !== 'materials' ? <SearchField label="Buscar evidências" value={query} onValueChange={value => { setQuery(value); setCursors([undefined]); }} /> : undefined}
      actions={tab !== 'materials' ? <Select label="Ordenação" value={sort ?? 'newest'} onChange={value => { setSort(value as MemoryQuery['sort']); setCursors([undefined]); }} options={[{ value: 'newest', label: 'Mais recentes' }, { value: 'oldest', label: 'Mais antigas' }, { value: 'relevance', label: 'Relevância' }, { value: 'confidence', label: 'Confiança factual' }, { value: 'usage', label: 'Mais usadas' }]} /> : undefined} />
    {filtersOpen && tab !== 'materials' && <MemoryFilters key={JSON.stringify(filters)} applied={filters} onApply={value => { setFilters(value); setCursors([undefined]); setFiltersOpen(false); }} />}
    {tab === 'materials' ? <MemoryMaterials key={materialId ?? 'materials'} onOpen={id => { setMaterialId(id); setMaterialOpen(true); }} /> : <>
      {material && <Section title={material.title} action={<Button variant="ghost" onClick={() => { setMaterial(undefined); setCursors([undefined]); }}>Limpar material</Button>} />}
      {error && <Alert tone="danger" title={error} />}
      {resource.error ? <ErrorState title="Não foi possível carregar o banco" description={resource.error} onRetry={resource.reload} /> : !page ? <Spinner label="Carregando evidências" /> : <DataTable
        label="Evidências" rows={page.items} rowKey={item => item.evidence.id} rowLabel={item => item.evidence.anchor.excerpt.slice(0, 80)} onRowClick={item => { setEvidenceId(item.evidence.id); setEvidenceOpen(true); }}
        selectable={canEdit} selected={new Set(selected.map(item => item.id))} onSelectedChange={next => {
          setError(page.items.some(item => next.has(item.evidence.id) && !item.eligibility.usable) ? 'Conclua a revisão e a confirmação de autoria antes de selecionar a evidência.' : undefined);
          setSelected(current => {
          const pageIds = new Set(page.items.map(item => item.evidence.id));
          const kept = current.filter(item => !pageIds.has(item.id) || next.has(item.id));
          const added = page.items.filter(item => item.eligibility.usable && next.has(item.evidence.id) && !kept.some(ref => ref.id === item.evidence.id));
          return [...kept, ...added.map(item => memoryEvidenceRef(item.evidence))].slice(0, 100);
          });
        }}
        columns={[{ key: 'text', header: 'Evidência', pinned: true, render: item => item.evidence.anchor.excerpt.slice(0, 180) },
          { key: 'kind', header: 'Tipo', render: item => item.evidence.kind === 'citation' ? 'Citação' : 'Estatística' },
          { key: 'author', header: 'Autoria / instituição', render: item => item.evidence.kind === 'statistic' ? item.evidence.issuingInstitution ?? 'Não informada' : people.data?.find(person => person.id === (item.evidence.kind === 'citation' ? item.evidence.personId : null))?.name ?? 'Não identificada' },
          { key: 'material', header: 'Material', render: item => item.material.title },
          { key: 'status', header: 'Estado', render: item => <Badge tone={item.eligibility.usable ? 'green' : 'amber'} wrap>{ELIGIBILITY_LABELS[item.eligibility.reason]}</Badge> },
          { key: 'confidence', header: 'Confiança factual', render: item => item.checkState === 'outdated' ? 'Desatualizada' : item.check?.confidence === null || item.check?.confidence === undefined ? '—' : `${item.check.confidence}%` },
          { key: 'uses', header: 'Artigos', render: item => item.uses.inserted }]}
        empty={<EmptyState title={query || material ? 'Nenhuma evidência encontrada' : 'Nenhuma evidência no banco'} description={query || material ? undefined : 'Importe um material para iniciar a extração.'} />}
        footer={<ButtonGroup label="Ações"><Button variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button><Button variant="secondary" disabled={!page.nextCursor} onClick={() => setCursors(current => [...current, page.nextCursor!])}>Próxima</Button></ButtonGroup>} />}
      {selected.length > 0 && <Section title={`${selected.length} evidências selecionadas`} action={<ButtonGroup label="Ações"><Button variant="secondary" onClick={() => setSelected([])}>Limpar seleção</Button><Button loading={saving} onClick={async () => {
        if (!resource.port) return; setSaving(true); setError(undefined);
        try { const selection = await resource.port.select({ productionId: null, baseRevision: 0, evidence: selected }, crypto.randomUUID()); toast('Seleção salva', { description: `${selection.items.length} evidências preservadas na ordem escolhida.` }); setSelected([]); }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a seleção.'); } finally { setSaving(false); }
      }}>Salvar seleção</Button></ButtonGroup>} />}
    </>}
    {resource.port && <MemoryImportDialog port={resource.port} open={importing} onClose={() => setImporting(false)} onImported={id => { setImporting(false); setMaterialId(id); setTab('materials'); reset(); toast('Material importado'); }} />}
    {materialId && <MemoryMaterialDrawer key={materialId} id={materialId} open={materialOpen} onClose={() => setMaterialOpen(false)} onEvidence={item => { setMaterial(item); setMaterialOpen(false); setEvidenceOpen(false); setTab('all'); setCursors([undefined]); }} />}
    {evidenceId && <MemoryEvidenceDrawer key={evidenceId} id={evidenceId} open={evidenceOpen} onClose={() => setEvidenceOpen(false)} onChanged={resource.reload} onMaterial={item => { setMaterialId(item.id); setMaterialOpen(true); }} />}
  </PageStack>;
}
