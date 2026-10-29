'use client';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { memoryAddressParams, readMemoryAddress, type MemoryAddress, type MemoryTab } from '@/domain/editorial-memory-address';
import { Alert, Badge, Button, ButtonGroup, DataTable, EmptyState, ErrorState, FilterBar, PageHeader, PageStack, SearchField, Section, Select, Spinner, Tabs, toast } from '@content-ventures/design-system/v3';
import { Plus, RotateCw } from '@content-ventures/design-system/v3/icons';
import type { MemoryEvidenceChoice, MemoryMaterial, MemoryQuery, MemorySelection } from '@/domain/editorial-memory';
import { captureMemoryChoice, memoryChoiceFromItem } from '@/domain/editorial-memory-discovery';
import type { MemoryImpactScope, MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, usePeople } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { ELIGIBILITY_LABELS, MemoryEvidenceDrawer } from './memory-evidence-detail';
import { MemoryFilters } from './memory-filters';
import { MemoryImportDialog, MemoryMaterialDrawer, MemoryMaterials } from './memory-materials';
import { MemorySelectionDialog } from './memory-selection-dialog';
import { MemorySelections } from './memory-selections';
import { MemoryImpactDrawer } from './memory-impact-drawer';
import { MemoryFeedbackPanel } from './memory-feedback';
import { MemoryPolicyPanel } from './memory-policy-panel';

export function MemoryLibraryScreen() {
  const search = useSearchParams().toString();
  const address = useMemo(() => readMemoryAddress(new URLSearchParams(search)), [search]);
  const route = useMemo<MemoryAddress>(() => address.ok ? address.value : { tab: 'all', query: {} }, [address]);
  const feedbackQuery = useMemo(() => route.feedback ?? {}, [route.feedback]);
  const { tab, query: input } = route, query = input.query ?? '', sort = input.sort ?? 'newest', cursor = input.cursor;
  const filters = useMemo(() => Object.fromEntries(Object.entries(input).filter(([key]) => !['query', 'sort', 'cursor'].includes(key))) as MemoryQuery, [input]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const navigate = (state: MemoryAddress, push = false) => {
    const url = new URL(window.location.href); url.search = memoryAddressParams(url.searchParams, state).toString();
    window.history[push ? 'pushState' : 'replaceState'](null, '', url.pathname + url.search + url.hash);
  };
  const changeQuery = (patch: MemoryQuery, nextTab: MemoryTab = tab) => { setCursors([undefined]); navigate({ tab: nextTab, query: { ...input, ...patch, cursor: undefined } }); };
  const [material, setMaterial] = useState<MemoryMaterial>(), [materialId, setMaterialId] = useState<string>(), [evidenceId, setEvidenceId] = useState<string>(), [importing, setImporting] = useState(false);
  const [materialOpen, setMaterialOpen] = useState(false), [evidenceOpen, setEvidenceOpen] = useState(false);
  const [impact, setImpact] = useState<MemoryImpactScope>(), [impactOpen, setImpactOpen] = useState(false);
  const openImpact = (scope: MemoryImpactScope) => { setImpact(scope); setImpactOpen(true); };
  const [selected, setSelected] = useState<MemoryEvidenceChoice[]>([]), [selection, setSelection] = useState<MemorySelection>(), [selectionOpen, setSelectionOpen] = useState(false), [error, setError] = useState<string>();
  const [selectionsRefresh, setSelectionsRefresh] = useState(0);
  const [feedbackRefresh, setFeedbackRefresh] = useState(0);
  const [policyRefresh, setPolicyRefresh] = useState(0);
  const people = usePeople(), canEdit = useCan('library.edit'), canAdmin = useCan('pipeline.edit'), browsing = !['materials', 'selections', 'feedback', 'policy'].includes(tab);
  const load = useCallback((port: MemoryLibrary) => port.query({ ...input, ...(tab === 'citation' || tab === 'statistic' ? { kind: tab } : {}), limit: 25 }), [tab, input]);
  const resource = useMemoryResource(load, 0, browsing && address.ok), page = resource.data;
  const reset = () => { changeQuery({}); resource.reload(); setSelectionsRefresh(value => value + 1); setFeedbackRefresh(value => value + 1); setPolicyRefresh(value => value + 1); };
  return <PageStack>
    <PageHeader title="Banco de citações e estatísticas" actions={<>{canEdit && <Button icon={Plus} onClick={() => setImporting(true)}>Importar material</Button>}<Button variant="secondary" icon={RotateCw} onClick={reset}>Atualizar</Button></>} />
    <FilterBar filters={browsing} filtersOpen={filtersOpen && browsing} onFiltersOpenChange={setFiltersOpen} filterCount={Object.values(filters).filter(value => value !== undefined).length} tabs={<Tabs key={canAdmin ? 'administrator-tabs' : 'member-tabs'} label="Conteúdo do banco" value={tab} onChange={value => { if (value === 'feedback' || value === 'policy') navigate({ tab: value, query: {} }); else changeQuery({}, value as MemoryTab); }} items={[{ value: 'all', label: 'Todas' }, { value: 'citation', label: 'Citações' }, { value: 'statistic', label: 'Estatísticas' }, { value: 'materials', label: 'Materiais' }, { value: 'selections', label: 'Seleções' }, { value: 'feedback', label: 'Feedback' }, ...(canAdmin ? [{ value: 'policy', label: 'Política' }] : [])]} />}
      search={browsing ? <SearchField label="Buscar evidências" value={query} onValueChange={value => { changeQuery({ query: value }); }} /> : undefined}
      actions={browsing ? <Select label="Ordenação" value={sort ?? 'newest'} onChange={value => { changeQuery({ sort: value as MemoryQuery['sort'] }); }} options={[{ value: 'newest', label: 'Mais recentes' }, { value: 'oldest', label: 'Mais antigas' }, { value: 'relevance', label: 'Relevância' }, { value: 'confidence', label: 'Confiança factual' }, { value: 'usage', label: 'Mais usadas' }]} /> : undefined} />
    {filtersOpen && browsing && <MemoryFilters key={JSON.stringify(filters)} applied={filters} onApply={value => { setCursors([undefined]); navigate({ tab, query: { ...value, query, sort } }); setFiltersOpen(false); }} />}
    {tab === 'policy' ? <MemoryPolicyPanel key={policyRefresh} /> : tab === 'feedback' ? <MemoryFeedbackPanel key={feedbackRefresh} query={feedbackQuery} onQuery={feedback => navigate({ tab: 'feedback', query: {}, feedback }, true)} onTarget={target => {
      if (target.kind === 'material') { setMaterialId(target.id); setMaterialOpen(true); } else { setEvidenceId(target.id); setEvidenceOpen(true); }
    }} /> : tab === 'materials' ? <MemoryMaterials key={materialId ?? 'materials'} onOpen={id => { setMaterialId(id); setMaterialOpen(true); }} /> : tab === 'selections' ? <MemorySelections refresh={selectionsRefresh} onOpen={item => { setSelection(item); setSelected(item.items.map(memoryChoiceFromItem)); setSelectionOpen(true); }} /> : <>
      {input.materialId && <Section title={material?.id === input.materialId ? material.title : page?.items.find(item => item.material.id === input.materialId)?.material.title ?? 'Material selecionado'} action={<Button variant="ghost" onClick={() => { setMaterial(undefined); changeQuery({ materialId: undefined }); }}>Limpar material</Button>} />}
      {error && <Alert tone="danger" title={error} />}
      {!address.ok ? <ErrorState title="Filtros inválidos" description={address.refusal.message} actions={<Button onClick={() => { setCursors([undefined]); navigate({ tab: 'all', query: {} }); }}>Limpar filtros</Button>} /> : resource.error ? <ErrorState title="Não foi possível carregar o banco" description={resource.error} onRetry={cursor ? undefined : resource.reload} actions={cursor ? <Button onClick={reset}>Atualizar consulta</Button> : undefined} /> : !page ? <Spinner label="Carregando evidências" /> : <DataTable
        label="Evidências" rows={page.items} rowKey={item => item.evidence.id} rowLabel={item => item.evidence.anchor.excerpt.slice(0, 80)} onRowClick={item => { setEvidenceId(item.evidence.id); setEvidenceOpen(true); }}
        selectable={canEdit} selected={new Set(selected.map(item => item.id))} onSelectedChange={next => {
          setError(page.items.some(item => next.has(item.evidence.id) && !item.eligibility.usable) ? 'Conclua a revisão e a confirmação de autoria antes de selecionar a evidência.' : undefined);
          setSelected(current => {
          const pageIds = new Set(page.items.map(item => item.evidence.id));
          const kept = current.filter(item => !pageIds.has(item.id) || next.has(item.id));
          const added = page.items.filter(item => item.eligibility.usable && next.has(item.evidence.id) && !kept.some(ref => ref.id === item.evidence.id));
          return [...kept, ...added.map(item => captureMemoryChoice(item.evidence, { ...input, ...(tab === 'citation' || tab === 'statistic' ? { kind: tab } : {}) }, page.snapshot))].slice(0, 100);
          });
        }}
        columns={[{ key: 'text', header: 'Evidência', pinned: true, render: item => item.evidence.anchor.excerpt.slice(0, 180) },
          { key: 'kind', header: 'Tipo', render: item => item.evidence.kind === 'citation' ? 'Citação' : 'Estatística' },
          { key: 'author', header: 'Autoria / instituição', render: item => item.evidence.kind === 'statistic' ? item.evidence.issuingInstitution ?? 'Não informada' : people.data?.find(person => person.id === (item.evidence.kind === 'citation' ? item.evidence.personId : null))?.name ?? 'Não identificada' },
          { key: 'material', header: 'Material', render: item => item.material.title },
          { key: 'status', header: 'Estado', render: item => <Badge tone={item.eligibility.usable ? 'green' : 'amber'} wrap>{ELIGIBILITY_LABELS[item.eligibility.reason]}</Badge> },
          { key: 'confidence', header: 'Confiança factual', render: item => item.checkState === 'outdated' ? 'Desatualizada' : item.check?.confidence === null || item.check?.confidence === undefined ? '—' : `${item.check.confidence}%` },
          { key: 'uses', header: 'Artigos', render: item => item.uses.inserted }]}
        empty={<EmptyState title={query || input.materialId ? 'Nenhuma evidência encontrada' : 'Nenhuma evidência no banco'} description={query || input.materialId ? undefined : 'Importe um material para iniciar a extração.'} />}
        footer={<ButtonGroup label="Ações"><Button variant="secondary" disabled={!cursor} onClick={() => navigate({ tab, query: { ...input, cursor: cursors.indexOf(cursor) > 0 ? cursors[cursors.indexOf(cursor) - 1] : undefined } }, true)}>{cursors.indexOf(cursor) < 0 ? 'Primeira página' : 'Anterior'}</Button><Button variant="secondary" disabled={!page.nextCursor} onClick={() => {
          setCursors(current => { const index = current.indexOf(cursor); return [...(index < 0 ? [undefined, cursor] : current.slice(0, index + 1)), page.nextCursor!]; });
          navigate({ tab, query: { ...input, cursor: page.nextCursor! } }, true);
        }}>Próxima</Button></ButtonGroup>} />}
      {selected.length > 0 && <Section title={`${selected.length} evidências selecionadas`} action={<ButtonGroup label="Ações"><Button variant="secondary" onClick={() => { setSelected([]); setSelection(undefined); }}>Limpar seleção</Button><Button onClick={() => setSelectionOpen(true)}>Organizar e escrever</Button></ButtonGroup>} />}
    </>}
    {resource.port && <MemoryImportDialog port={resource.port} open={importing} onClose={() => setImporting(false)} onImported={id => { setImporting(false); setMaterialId(id); changeQuery({}, 'materials'); setSelectionsRefresh(value => value + 1); toast('Material importado'); }} />}
    {materialId && <MemoryMaterialDrawer key={materialId} id={materialId} open={materialOpen} onClose={() => setMaterialOpen(false)} onImpact={() => openImpact({ kind: 'material', id: materialId })} onEvidence={item => { setMaterial(item); setMaterialOpen(false); setEvidenceOpen(false); changeQuery({ materialId: item.id }, 'all'); }} />}
    {evidenceId && <MemoryEvidenceDrawer key={evidenceId} id={evidenceId} open={evidenceOpen} onClose={() => setEvidenceOpen(false)} onChanged={resource.reload} onImpact={id => openImpact({ kind: 'evidence', id })} onMaterial={item => { setMaterialId(item.id); setMaterialOpen(true); }} />}
    {impact && <MemoryImpactDrawer key={`${impact.kind}:${impact.id}`} scope={impact} open={impactOpen} onClose={() => setImpactOpen(false)} onSelection={value => { setSelection(value); setSelected(value.items.map(memoryChoiceFromItem)); setSelectionOpen(true); }} />}
    <MemorySelectionDialog open={selectionOpen} evidence={selected} selection={selection} onClose={() => setSelectionOpen(false)} onChange={setSelected} onSaved={value => { setSelection(value); setSelected(value.items.map(memoryChoiceFromItem)); setSelectionsRefresh(current => current + 1); }} />
  </PageStack>;
}
