'use client';
import { useCallback, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Checkbox, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, Field, FieldGroup, Input, Panel, Progress, ResponsiveDialog, Section, Select, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryMaterial, MemoryMetadata } from '@/domain/editorial-memory';
import type { MemoryLibrary, MemoryImportInput, MemoryJob } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { useCan, useSession } from '@/state';

export const MATERIAL_KINDS = [
  { value: 'transcript', label: 'Transcrição' }, { value: 'news', label: 'Notícia' }, { value: 'release', label: 'Release' },
  { value: 'report', label: 'Relatório' }, { value: 'archive', label: 'Acervo' }, { value: 'market_data', label: 'Dados de mercado' },
];
const JOB_LABELS: Record<MemoryJob['status'], string> = { queued: 'Na fila', running: 'Extraindo', partial: 'Parcial', completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' };
const BLANK_METADATA: MemoryMetadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
const blankImport = (): MemoryImportInput => ({ title: '', kind: 'transcript', text: '', authorized: false, metadata: structuredClone(BLANK_METADATA), primaryOrigin: null, originalFileId: null });
export function JobStatus({ job }: { job: MemoryJob | null }) {
  return <Badge tone={job?.status === 'completed' ? 'green' : job?.status === 'failed' || job?.status === 'partial' ? 'amber' : 'gray'}>{job ? JOB_LABELS[job.status] : 'Sem extração'}</Badge>;
}
export function MemoryImportDialog({ port, open, onClose, onImported }: { port: MemoryLibrary; open: boolean; onClose: () => void; onImported: (id: string) => void }) {
  const [input, setInput] = useState<MemoryImportInput>(blankImport);
  const [topicsText, setTopicsText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const setMetadata = (field: keyof MemoryMetadata, value: string) => setInput(current => ({ ...current, metadata: { ...current.metadata, [field]: field === 'topics' ? value.split(',').map(topic => topic.trim()).filter(Boolean) : value || null } }));
  return <ResponsiveDialog open={open} title="Importar material" dirty={Boolean(input.title || input.text)} onClose={busy ? () => undefined : onClose}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!input.title.trim() || input.text.trim().length < 24} onClick={async () => {
      setBusy(true); setError(undefined);
      try { const result = await port.import(input, requestId); setInput(blankImport()); setTopicsText(''); setRequestId(crypto.randomUUID()); onImported(result.material.id); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível importar.'); }
      finally { setBusy(false); }
    }}>Importar</Button></>}>
    <Section>
      {error && <Alert tone="danger" title={error} />}
      <Field label="Título" required>{({ id }) => <Input id={id} value={input.title} maxLength={160} onChange={event => setInput({ ...input, title: event.target.value })} />}</Field>
      <Field label="Tipo">{({ id }) => <Select id={id} value={input.kind} options={MATERIAL_KINDS} onChange={kind => setInput({ ...input, kind: kind as MemoryImportInput['kind'] })} />}</Field>
      <Field label="Texto original" required hint="Até 1 MiB. O original será preservado integralmente.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={10} value={input.text} onChange={event => setInput({ ...input, text: event.target.value })} />}</Field>
      <Field label="Documento ou origem principal" optional hint="Use a mesma origem para partes ou republicações.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={input.primaryOrigin ?? ''} onChange={event => setInput({ ...input, primaryOrigin: event.target.value || null })} />}</Field>
      <FieldGroup label="Origem" columns={2}>
        <Field label="URL original" optional>{({ id }) => <Input id={id} type="url" value={input.metadata.originalUrl ?? ''} onChange={event => setMetadata('originalUrl', event.target.value)} />}</Field>
        <Field label="Instituição" optional>{({ id }) => <Input id={id} value={input.metadata.institution ?? ''} onChange={event => setMetadata('institution', event.target.value)} />}</Field>
        <Field label="Data da fala" optional>{({ id }) => <Input id={id} type="date" value={input.metadata.recordedOn ?? ''} onChange={event => setMetadata('recordedOn', event.target.value)} />}</Field>
        <Field label="Data de publicação" optional>{({ id }) => <Input id={id} type="date" value={input.metadata.publishedOn ?? ''} onChange={event => setMetadata('publishedOn', event.target.value)} />}</Field>
        <Field label="Empresa" optional>{({ id }) => <Input id={id} value={input.metadata.company ?? ''} onChange={event => setMetadata('company', event.target.value)} />}</Field>
        <Field label="Evento" optional>{({ id }) => <Input id={id} value={input.metadata.event ?? ''} onChange={event => setMetadata('event', event.target.value)} />}</Field>
        <Field label="Edição" optional>{({ id }) => <Input id={id} value={input.metadata.edition ?? ''} onChange={event => setMetadata('edition', event.target.value)} />}</Field>
        <Field label="Temas" optional>{({ id }) => <Input id={id} value={topicsText} onChange={event => { setTopicsText(event.target.value); setMetadata('topics', event.target.value); }} />}</Field>
      </FieldGroup>
      <Checkbox label="Confirmo a autorização de uso deste material" checked={input.authorized} onChange={event => setInput({ ...input, authorized: event.target.checked })} />
    </Section>
  </ResponsiveDialog>;
}
export function MemoryMaterials({ onOpen }: { onOpen: (id: string) => void }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors.at(-1);
  const load = useCallback((port: MemoryLibrary) => port.materials({ limit: 25, cursor }), [cursor]);
  const resource = useMemoryResource(load, 5000);
  if (resource.error) return <ErrorState title="Não foi possível carregar os materiais" description={resource.error} onRetry={resource.reload} />;
  if (!resource.data) return <Spinner label="Carregando materiais" />;
  return <DataTable label="Materiais" rows={resource.data.items} rowKey={material => material.id} rowLabel={material => material.title} onRowClick={material => onOpen(material.id)}
    columns={[{ key: 'title', header: 'Material', pinned: true, render: material => material.title },
      { key: 'kind', header: 'Tipo', render: material => MATERIAL_KINDS.find(kind => kind.value === material.kind)?.label },
      { key: 'status', header: 'Extração', render: material => <JobStatus job={material.job} /> },
      { key: 'blocks', header: 'Blocos', render: material => material.job ? `${material.job.completedBlocks}/${material.job.totalBlocks}` : '—' },
      { key: 'evidence', header: 'Evidências', render: material => material.job?.evidenceCount ?? 0 }]}
    empty={<EmptyState title="Nenhum material importado" />}
    footer={<ButtonGroup label="Ações"><Button variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
      <Button variant="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(current => [...current, resource.data!.nextCursor!])}>Próxima</Button></ButtonGroup>} />;
}
export function MemoryMaterialDrawer({ id, open, onClose, onEvidence }: { id: string; open: boolean; onClose: () => void; onEvidence: (material: MemoryMaterial) => void }) {
  const session = useSession().data;
  const load = useCallback((port: MemoryLibrary) => port.material(id), [id]), resource = useMemoryResource(load, 3000, open), canEdit = useCan('library.edit');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [rightsReason, setRightsReason] = useState('');
  const detail = resource.data, job = detail?.job;
  const act = async (action: 'retry' | 'cancel') => {
    if (!resource.port || !job) return;
    setBusy(true); setError(undefined);
    try { if (action === 'retry') await resource.port.retry(job.id, crypto.randomUUID()); else await resource.port.cancel(job.id, job.revision, crypto.randomUUID()); resource.reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o processamento.'); }
    finally { setBusy(false); }
  };
  return <Drawer open={open} title={detail?.material.title ?? 'Material'} onClose={onClose} size="lg">
    {resource.error ? <ErrorState title="Não foi possível abrir o material" description={resource.error} onRetry={resource.reload} /> : !detail ? <Spinner label="Carregando original" /> : <Panel>
      <Section title="Processamento" meta={<JobStatus job={job ?? null} />}>
        {error && <Alert tone="danger" title={error} />}
        {job && <Progress value={job.completedBlocks / job.totalBlocks * 100} label={`${job.completedBlocks} de ${job.totalBlocks} blocos concluídos`} />}
        <DescriptionList items={[{ label: 'Evidências', value: job?.evidenceCount ?? 0 }, { label: 'Blocos com falha', value: job?.failedBlocks ?? 0 },
          ...(job?.error ? [{ label: 'Falha', value: job.error === 'MEMORY_SOURCE_NOT_AUTHORIZED' ? 'Autorize o uso do material para retomar.' : job.error === 'MEMORY_SOURCE_CHANGED' ? 'A fonte mudou. Importe a versão atual.' : /KEY_MISSING|AUTH_INVALID|QUOTA_EXHAUSTED/.test(job.error) ? 'Confira o acesso e os créditos do provedor de IA.' : 'Não foi possível concluir. Retome a extração.' }] : []),
          { label: 'Importado por', value: session?.current?.id === detail.material.importedBy ? session.current.name : session?.members.find(member => member.id === detail.material.importedBy)?.name ?? detail.material.importedBy }]} />
        <ButtonGroup label="Ações"><Button variant="secondary" onClick={() => onEvidence(detail.material)}>Ver evidências</Button>
          {canEdit && job && ['failed', 'partial', 'cancelled'].includes(job.status) && <Button loading={busy} onClick={() => void act('retry')}>Retomar extração</Button>}
          {canEdit && job && ['queued', 'running'].includes(job.status) && <Button variant="secondary" loading={busy} onClick={() => void act('cancel')}>Cancelar extração</Button>}
        </ButtonGroup>
      </Section>
      {canEdit && <Section title="Autorização de uso" meta={detail.source.rights.authorized ? 'Autorizado' : 'Pendente'}>
        <Field label="Motivo da autorização ou revogação" required>{({ id }) => <Input id={id} value={rightsReason} maxLength={2000} onChange={event => setRightsReason(event.target.value)} />}</Field>
        <Button variant="secondary" loading={busy} disabled={!rightsReason.trim()} onClick={async () => {
          if (!resource.port) return; setBusy(true); setError(undefined);
          try { await resource.port.authorizeMaterial(detail.material.id, { baseRevision: detail.material.revision, authorized: !detail.source.rights.authorized, reason: rightsReason }, crypto.randomUUID()); setRightsReason(''); resource.reload(); }
          catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a autorização.'); } finally { setBusy(false); }
        }}>{detail.source.rights.authorized ? 'Revogar autorização' : 'Autorizar uso'}</Button>
      </Section>}
      <Section title="Original preservado"><Textarea aria-label="Texto original preservado" readOnly rows={18} value={detail.source.versions[0]?.content.segments.map(segment => segment.text).join('\n') ?? ''} /></Section>
    </Panel>}
  </Drawer>;
}
