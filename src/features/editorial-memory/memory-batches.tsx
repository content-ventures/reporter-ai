'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, Field, LiveRegion, Panel, Section, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import type { MemoryBatch, MemoryBatchItem } from '@/ports/editorial-memory-batch';
import { useMemoryResource } from '@/state/use-memory-library';
import { useCan } from '@/state';
import { MemoryBatchCreate } from './memory-batch-create';
import { MemoryBatchItemEditor } from './memory-batch-item-editor';
import { JobStatus } from './memory-materials';
import { MemoryOriginalDownload } from './memory-original-download';
import { batchFailureMessage, describeBatchFile } from './memory-batch-files';

const labels: Record<MemoryBatchItem['status'], string> = { needs_file: 'Selecionar arquivo', uploading: 'Envio pendente', ready: 'Pronto para importar', failed: 'Falha recuperável', refused: 'Recusado', included: 'Incluído', existing: 'Já existente', pending_review: 'Revisar correspondência' };
export function MemoryBatchManager(props: { port: MemoryLibrary; open: boolean; initialBatchId?: string; onClose: () => void; onMaterial: (id: string) => void }) {
  const binding = useMemo(() => ({ port: props.port, key: crypto.randomUUID() }), [props.port, props.initialBatchId]);
  return <BatchManager key={binding.key} {...props} />;
}
function BatchManager({ port, open, initialBatchId, onClose, onMaterial }: { port: MemoryLibrary; open: boolean; initialBatchId?: string; onClose: () => void; onMaterial: (id: string) => void }) {
  const [creating, setCreating] = useState(false), [id, setId] = useState<string | undefined>(initialBatchId), [cursor, setCursor] = useState<string>();
  const [selection, setSelected] = useState<MemoryBatchItem>(), [editBasis, setEditBasis] = useState<{ key: string; item: MemoryBatchItem }>(), [editing, setEditing] = useState(false), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState<string>();
  const [active, setActive] = useState<{ id: string; stage: string }>();
  const files = useRef(new Map<string, File>()), live = useRef(true), running = useRef(false), pause = useRef(false);
  const action = useRef<{ signature: string; key: string }>(undefined);
  useEffect(() => { const selectedFiles = files.current; live.current = true; return () => { live.current = false; pause.current = true; selectedFiles.clear(); }; }, []);
  const canEdit = useCan('library.edit');
  const listLoad = useCallback((library: MemoryLibrary) => library.batches({ limit: 25, cursor }), [cursor]);
  const list = useMemoryResource(listLoad, 5000, open);
  const detailLoad = useCallback((library: MemoryLibrary) => library.batch(id!), [id]);
  const detail = useMemoryResource(detailLoad, 3000, open && Boolean(id));
  const [current, setCurrent] = useState<MemoryBatch>();
  const batch = current && current.id === id && (!detail.data || current.updatedAt >= detail.data.updatedAt) ? current : detail.data;
  const selected = selection && batch?.items.find(item => item.id === selection.id);
  const update = (value: MemoryBatch) => { if (live.current) { setCurrent(value); list.reload(); detail.reload(); } };
  const key = (operation: object) => { const signature = JSON.stringify(operation); if (action.current?.signature !== signature) action.current = { signature, key: crypto.randomUUID() }; return action.current.key; };
  const run = async () => {
    if (!batch || running.current) return; running.current = true; pause.current = false; setBusy(true); setError(undefined);
    try {
      let state = await port.batch(batch.id);
      for (const entry of state.items) {
        if (!live.current || pause.current) break;
        if (['included', 'existing', 'pending_review', 'refused'].includes(entry.status)) continue;
        let item = state.items.find(item => item.id === entry.id)!;
        try {
          setMessage(`Importando ${item.file.name}…`);
          const local = files.current.get(item.id);
          if (item.original?.status !== 'stored' && local) {
            setActive({ id: item.id, stage: 'Enviando original' });
            const description = await describeBatchFile(local);
            if (!live.current) return;
            if (description.checksum !== item.file.checksum || description.size !== item.file.size) throw new Error('Selecione o mesmo arquivo registrado no lote ou revise o documento.');
            state = await port.uploadBatchItem(state.id, item.id, { revision: item.revision, bytes: new Uint8Array(await local.arrayBuffer()) }, key({ upload: item.id, revision: item.revision }));
            if (!live.current) return; update(state); item = state.items.find(value => value.id === item.id)!;
          }
          if (!item.original) continue;
          setActive({ id: item.id, stage: 'Importando documento' });
          state = await port.processBatchItem(state.id, item.id, { revision: item.revision }, key({ process: item.id, revision: item.revision }));
          if (!live.current) return; update(state);
        } catch (failure) {
          if (!live.current) return;
          if ([401, 403, 404].includes((failure as { status?: number }).status ?? 0)) throw failure;
          setError(batchFailureMessage(failure)); state = await port.batch(state.id); update(state);
        }
      }
      if (live.current) update(state);
    } catch (failure) { if (live.current) setError(batchFailureMessage(failure)); }
    finally { running.current = false; if (live.current) { setBusy(false); setMessage(''); setActive(undefined); } }
  };
  const decide = async (choice: 'reuse' | 'distinct') => {
    if (!batch || !selected?.candidate || running.current) return;
    const input = { revision: selected.revision, decision: { choice, expected: selected.candidate, reason } };
    running.current = true; setBusy(true); setError(undefined);
    try { const value = await port.processBatchItem(batch.id, selected.id, input, key({ batch: batch.id, item: selected.id, input })); if (live.current) { update(value); setSelected(undefined); setReason(''); } }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível resolver a correspondência.'); }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  return <>
    <Drawer open={open} title="Importações" onClose={onClose} size="lg" footer={canEdit ? <Button onClick={() => setCreating(true)}>Novo lote</Button> : undefined}>
      {list.error ? <ErrorState title="Não foi possível carregar os lotes" description={list.error} onRetry={list.reload} actions={cursor ? <Button onClick={() => setCursor(undefined)}>Atualizar lotes</Button> : undefined} /> : !list.data ? <Spinner label="Carregando lotes" /> : <DataTable label="Lotes de documentos" rows={list.data.items} rowKey={row => row.id} rowLabel={row => row.title} onRowClick={row => { setId(row.id); setCurrent(undefined); setError(undefined); }}
        columns={[{ key: 'title', header: 'Lote', pinned: true, render: row => row.title }, { key: 'resolved', header: 'Importados', render: row => `${row.resolved}/${row.total}` }, { key: 'review', header: 'Revisar', render: row => row.pendingReview }, { key: 'refused', header: 'Recusados', render: row => row.refused }]}
        empty={<EmptyState title="Nenhum lote importado" />} footer={<ButtonGroup label="Páginas de lotes"><Button variant="secondary" disabled={!cursor} onClick={() => setCursor(undefined)}>Primeira página</Button><Button variant="secondary" disabled={!list.data.nextCursor} onClick={() => setCursor(list.data!.nextCursor!)}>Próxima</Button></ButtonGroup>} />}
    </Drawer>
    <MemoryBatchCreate port={port} open={open && creating} onClose={() => setCreating(false)} onCreated={(value, originals) => { for (const [key, file] of originals) files.current.set(key, file); setCurrent(value); setId(value.id); setCreating(false); list.reload(); }} />
    <Drawer open={open && Boolean(id)} title={batch?.title ?? 'Lote de documentos'} size="lg" onClose={() => { setId(undefined); setSelected(undefined); pause.current = true; }}>
      <LiveRegion message={message} />
      {detail.error ? <ErrorState title="Não foi possível abrir o lote" description={detail.error} onRetry={detail.reload} /> : !batch ? <Spinner label="Carregando lote" /> : <Panel><Section>
        {error && <Alert tone="danger" title={error} />}
        <DescriptionList items={[{ label: 'Documentos', value: batch.items.length }, { label: 'Importados', value: batch.items.filter(item => ['included', 'existing'].includes(item.status)).length }]} />
        {canEdit && <ButtonGroup label="Processamento do lote"><Button loading={busy} onClick={() => void run()}>{busy ? 'Importando…' : 'Importar documentos'}</Button>{busy && <Button variant="secondary" onClick={() => { pause.current = true; }}>Pausar após este documento</Button>}</ButtonGroup>}
        <DataTable label="Documentos do lote" rows={batch.items} rowKey={item => item.id} rowLabel={item => `${item.position + 1}. ${item.file.name}`} onRowClick={item => { setSelected(item); setReason(''); setError(undefined); }}
          columns={[{ key: 'file', header: 'Arquivo', pinned: true, render: item => item.file.name }, { key: 'status', header: 'Resultado', render: item => <Badge tone={item.status === 'refused' || item.status === 'failed' ? 'amber' : item.status === 'included' || item.status === 'existing' ? 'green' : 'gray'}>{active?.id === item.id ? active.stage : labels[item.status]}</Badge> }, { key: 'job', header: 'Extração', render: item => <JobStatus job={item.job} /> }, { key: 'issue', header: 'Pendência', render: item => item.issue?.message ?? (item.status === 'pending_review' ? 'Confira a origem e os metadados.' : '—') }]} />
      </Section></Panel>}
    </Drawer>
    <Drawer open={open && Boolean(selected)} title="Documento do lote" onClose={() => setSelected(undefined)} size="lg">
      {selected && <Panel><Section title={selected.file.name} meta={labels[selected.status]}>
        {error && <Alert tone="danger" title={error} />}
        <DescriptionList items={[{ label: 'Título', value: selected.input.title }, { label: 'Edição', value: selected.input.metadata.edition ?? 'Não informada' }, { label: 'Publicação', value: selected.input.metadata.publishedOn ?? 'Não informada' }]} />
        {selected.issue && <Alert tone="danger" title={selected.issue.message} />}
        {selected.original?.status === 'stored' && <MemoryOriginalDownload port={port} id={selected.original.id} />}
        {selected.materialId && <Button variant="secondary" onClick={() => onMaterial(selected.materialId!)}>Ver material</Button>}
        {canEdit && !['included', 'existing'].includes(selected.status) && <Button variant="secondary" disabled={busy} onClick={() => { setEditBasis(current => current?.item.id === selected.id && current.item.revision === selected.revision ? current : { key: crypto.randomUUID(), item: selected }); setEditing(true); }}>Revisar documento</Button>}
        {canEdit && selected.status === 'pending_review' && selected.candidate && <>
          <Button variant="secondary" onClick={() => onMaterial(selected.candidate!.id)}>Ver registro correspondente</Button>
          <Field label="Motivo da decisão" required>{({ id }) => <Textarea id={id} rows={3} maxLength={2000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
          <ButtonGroup label="Resolver correspondência"><Button loading={busy} disabled={!reason.trim()} onClick={() => void decide('reuse')}>Usar registro existente</Button><Button variant="secondary" loading={busy} disabled={!reason.trim()} onClick={() => void decide('distinct')}>Registrar documento distinto</Button></ButtonGroup>
        </>}
      </Section></Panel>}
    </Drawer>
    {editBasis && batch && <MemoryBatchItemEditor key={editBasis.key} port={port} batch={batch.id} item={editBasis.item} open={open && editing} onClose={() => setEditing(false)} onSaved={(value, file) => { if (file) files.current.set(editBasis.item.id, file); update(value); setSelected(value.items.find(item => item.id === editBasis.item.id)); setEditing(false); }} />}
  </>;
}
