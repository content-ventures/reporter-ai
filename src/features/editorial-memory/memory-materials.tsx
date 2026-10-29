'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, Field, Input, LiveRegion, Panel, Progress, Section, Spinner, Textarea, toast } from '@content-ventures/design-system/v3';
import type { MemoryMaterial } from '@/domain/editorial-memory';
import type { MemoryLibrary, MemoryJob } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { useCan, useSession } from '@/state';
import { MemoryMaterialRevisionDialog, type MaterialRevisionBasis } from './memory-material-revision-dialog';
import { MemoryOriginalDownload } from './memory-original-download';
import { MemoryMarketMappingDialog } from './memory-market-mapping';

import { MATERIAL_KINDS } from './memory-import-dialog';
export { MemoryImportDialog, MATERIAL_KINDS } from './memory-import-dialog';
const JOB_LABELS: Record<MemoryJob['status'], string> = { queued: 'Na fila', running: 'Extraindo', partial: 'Parcial', completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado' };
export function JobStatus({ job }: { job: MemoryJob | null }) {
  return <Badge tone={job?.status === 'completed' ? 'green' : job?.status === 'failed' || job?.status === 'partial' ? 'amber' : 'gray'}>{memoryJobLabel(job)}</Badge>;
}
export const memoryJobLabel = (job: MemoryJob | null) => job ? job.kind === 'check' && job.status === 'running' ? 'Checando' : JOB_LABELS[job.status] : 'Sem extração';
export function MemoryMaterials({ onOpen, cursor, onCursor, refresh }: { onOpen: (id: string) => void; cursor?: string; onCursor: (cursor?: string) => void; refresh: number }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const load = useCallback((port: MemoryLibrary) => port.materials({ limit: 25, cursor }), [cursor]);
  const resource = useMemoryResource(load, 5000);
  const { reload } = resource;
  const previousRefresh = useRef(refresh);
  useEffect(() => { if (previousRefresh.current !== refresh) { previousRefresh.current = refresh; reload(); } }, [refresh, reload]);
  if (resource.error) return <ErrorState title="Não foi possível carregar os materiais" description={resource.error} onRetry={cursor ? undefined : reload}
    actions={cursor ? <Button onClick={() => onCursor(undefined)}>Atualizar materiais</Button> : undefined} />;
  if (!resource.data) return <Spinner label="Carregando materiais" />;
  return <DataTable label="Materiais" rows={resource.data.items} rowKey={material => material.id} rowLabel={material => material.title} onRowClick={material => onOpen(material.id)}
    columns={[{ key: 'title', header: 'Material', pinned: true, render: material => material.title },
      { key: 'kind', header: 'Tipo', render: material => MATERIAL_KINDS.find(kind => kind.value === material.kind)?.label },
      { key: 'status', header: 'Extração', render: material => <JobStatus job={material.job} /> },
      { key: 'blocks', header: 'Blocos', render: material => material.job ? `${material.job.completedBlocks}/${material.job.totalBlocks}` : '—' },
      { key: 'evidence', header: 'Evidências', render: material => material.job?.evidenceCount ?? 0 }]}
    empty={<EmptyState title="Nenhum material importado" />}
    footer={<ButtonGroup label="Páginas de materiais"><Button variant="secondary" disabled={!cursor} onClick={() => onCursor(cursors.indexOf(cursor) > 0 ? cursors[cursors.indexOf(cursor) - 1] : undefined)}>{cursors.indexOf(cursor) < 0 ? 'Primeira página' : 'Anterior'}</Button>
      <Button variant="secondary" disabled={!resource.data.nextCursor} onClick={() => {
        const next = resource.data!.nextCursor!;
        setCursors(current => { const index = current.indexOf(cursor); return [...(index < 0 ? [undefined, cursor] : current.slice(0, index + 1)), next]; }); onCursor(next);
      }}>Próxima</Button></ButtonGroup>} />;
}
export function MemoryMaterialDrawer({ id, open, onClose, onEvidence, onImpact }: { id: string; open: boolean; onClose: () => void; onEvidence: (material: MemoryMaterial) => void; onImpact: () => void }) {
  const session = useSession().data;
  const [historical, setHistorical] = useState<number>(), [latestKnown, setLatestKnown] = useState<number>();
  const [editing, setEditing] = useState<MaterialRevisionBasis>(), [editingOpen, setEditingOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const load = useCallback((port: MemoryLibrary) => port.material(id, historical), [id, historical]), resource = useMemoryResource(load, 3000, open), canEdit = useCan('library.edit');
  const editable = canEdit && historical === undefined;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [rightsReason, setRightsReason] = useState('');
  const detail = resource.data, job = detail?.job;
  const act = async (action: 'retry' | 'cancel') => {
    if (!resource.port || !job) return;
    setBusy(true); setError(undefined);
    try { if (action === 'retry') await resource.port.retry(job.id, crypto.randomUUID()); else await resource.port.cancel(job.id, job.revision, crypto.randomUUID()); resource.reload(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o processamento.'); }
    finally { setBusy(false); }
  };
  return <><Drawer open={open} title={detail?.material.title ?? 'Material'} onClose={onClose} size="lg">
    <LiveRegion message={open && detail ? `Extração de ${detail.material.title}: ${memoryJobLabel(job ?? null)}.${job ? ` ${job.completedBlocks} de ${job.totalBlocks} blocos concluídos.` : ''}` : ''} />
    {resource.error ? <ErrorState title="Não foi possível abrir o material" description={resource.error} onRetry={resource.reload} /> : !detail ? <Spinner label="Carregando original" /> : <Panel>
      <Section title="Processamento" meta={<JobStatus job={job ?? null} />}>
        {error && <Alert tone="danger" title={error} />}
        {job && <Progress value={job.completedBlocks / job.totalBlocks * 100} label={`${job.completedBlocks} de ${job.totalBlocks} blocos concluídos`} />}
        <DescriptionList items={[{ label: 'Evidências', value: job?.evidenceCount ?? 0 }, { label: 'Blocos com falha', value: job?.failedBlocks ?? 0 },
          ...(job?.error ? [{ label: 'Falha', value: job.error === 'MEMORY_SOURCE_NOT_AUTHORIZED' ? 'Autorize o uso do material para retomar.' : job.error === 'MEMORY_SOURCE_CHANGED' ? 'A fonte mudou. Importe a versão atual.' : /KEY_MISSING|AUTH_INVALID|QUOTA_EXHAUSTED/.test(job.error) ? 'Confira o acesso e os créditos do provedor de IA.' : 'Não foi possível concluir. Retome a extração.' }] : []),
          { label: 'Importado por', value: session?.current?.id === detail.material.importedBy ? session.current.name : session?.members.find(member => member.id === detail.material.importedBy)?.name ?? detail.material.importedBy }]} />
        <ButtonGroup label="Ações"><Button variant="secondary" onClick={() => onEvidence(detail.material)}>Ver evidências</Button>
          {editable && job && ['failed', 'partial', 'cancelled'].includes(job.status) && <Button loading={busy} onClick={() => void act('retry')}>Retomar extração</Button>}
          {editable && job && ['queued', 'running'].includes(job.status) && <Button variant="secondary" loading={busy} onClick={() => void act('cancel')}>Cancelar extração</Button>}
        </ButtonGroup>
      </Section>
      {editable && <Section title="Autorização de uso" meta={detail.source.rights.authorized ? 'Autorizado' : 'Pendente'}>
        <Field label="Motivo da autorização ou revogação" required>{({ id }) => <Input id={id} value={rightsReason} maxLength={2000} onChange={event => setRightsReason(event.target.value)} />}</Field>
        <Button variant="secondary" loading={busy} disabled={!rightsReason.trim()} onClick={async () => {
          if (!resource.port) return; setBusy(true); setError(undefined);
          try { await resource.port.authorizeMaterial(detail.material.id, { baseRevision: detail.material.revision, authorized: !detail.source.rights.authorized, reason: rightsReason }, crypto.randomUUID()); setRightsReason(''); resource.reload(); }
          catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a autorização.'); } finally { setBusy(false); }
        }}>{detail.source.rights.authorized ? 'Revogar autorização' : 'Autorizar uso'}</Button>
      </Section>}
      <Section title="Original preservado" meta={historical === undefined ? 'Versão atual' : 'Somente consulta'}>
        <DescriptionList items={[{ label: 'Revisão do material', value: detail.material.revision }, { label: 'Versão do original', value: detail.material.source.sourceVersion },
          { label: 'Nome da publicação', value: detail.material.metadata.publication }, { label: 'Autor do documento', value: detail.material.metadata.documentAuthor },
          { label: 'Edição', value: detail.material.metadata.edition }, { label: 'Página ou seção informada', value: detail.material.metadata.documentSection },
          { label: 'Data de publicação', value: detail.material.metadata.publishedOn },
          { label: 'Registrada em', value: new Date(detail.source.versions[0].createdAt).toLocaleString('pt-BR') },
          { label: 'Registrada por', value: session?.current?.id === detail.source.versions[0].createdBy ? session.current.name : session?.members.find(member => member.id === detail.source.versions[0].createdBy)?.name ?? detail.source.versions[0].createdBy },
          ...(detail.source.versions[0].note ? [{ label: 'Motivo da versão', value: detail.source.versions[0].note }] : [])]} />
        <Textarea aria-label="Texto original preservado" readOnly rows={18} value={detail.source.versions[0]?.content.segments.map(segment => segment.text).join('\n') ?? ''} />
        {resource.port && detail.material.originalFileId && <MemoryOriginalDownload port={resource.port} id={detail.material.originalFileId} />}
        {editable && resource.port && detail.material.kind === 'market_data' && detail.material.originalFileId && <Button variant="secondary" onClick={() => setMappingOpen(true)}>Mapear dados de mercado</Button>}
        <ButtonGroup label="Histórico do material">
          <Button variant="secondary" onClick={onImpact}>Ver impacto da correção</Button>
          <Button variant="secondary" disabled={busy || detail.material.revision <= 1} onClick={() => { if (historical === undefined) setLatestKnown(detail.material.revision); setHistorical(detail.material.revision - 1); }}>Versão anterior</Button>
          <Button variant="secondary" disabled={busy || historical === undefined || historical >= (latestKnown ?? 0)} onClick={() => setHistorical(historical! + 1 === latestKnown ? undefined : historical! + 1)}>Próxima versão</Button>
          {historical !== undefined && <Button variant="ghost" onClick={() => setHistorical(undefined)}>Ver versão atual</Button>}
          {editable && resource.port && <Button onClick={() => {
            const port = resource.port!;
            setEditing(current => current?.material.revision === detail.material.revision && current.port === port ? current : { key: crypto.randomUUID(), material: detail.material, text: detail.source.versions[0].content.segments.map(segment => segment.text).join('\n'), port }); setEditingOpen(true);
          }}>Revisar original</Button>}
        </ButtonGroup>
      </Section>
    </Panel>}
  </Drawer>
    {editing && <MemoryMaterialRevisionDialog key={editing.key} basis={editing} open={open && editingOpen} onClose={() => setEditingOpen(false)} onSaved={result => {
      setEditingOpen(false); setHistorical(undefined); resource.reload(); toast('Original revisado', { description: `${result.affectedEvidence} evidências precisam de nova revisão editorial.` });
    }} />}
    {resource.port && <MemoryMarketMappingDialog key={`${id}:${mappingOpen}`} port={resource.port} materialId={id} open={open && mappingOpen} onClose={() => setMappingOpen(false)} />}
  </>;
}
