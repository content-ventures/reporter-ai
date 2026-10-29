'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Dropzone, Field, FileRow, Input, LiveRegion, ResponsiveDialog, Section, Select } from '@content-ventures/design-system/v3';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import type { MemoryBatch, MemoryBatchInput, MemoryBatchFields } from '@/ports/editorial-memory-batch';
import { MATERIAL_KINDS } from './memory-import-dialog';
import { describeBatchFile } from './memory-batch-files';

const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
export function MemoryBatchCreate({ port, open, onClose, onCreated }: { port: MemoryLibrary; open: boolean; onClose: () => void; onCreated: (batch: MemoryBatch, files: Map<string, File>) => void }) {
  const [title, setTitle] = useState(''), [files, setFiles] = useState<File[]>([]), [kind, setKind] = useState<MemoryBatchFields['kind']>('archive');
  const [authorized, setAuthorized] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState<string>();
  const live = useRef(true), running = useRef(false), prepared = useRef<{ files: File[]; items: MemoryBatchInput['items'] }>(undefined);
  const attempt = useRef<{ signature: string; key: string }>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const create = async () => {
    if (running.current) return; running.current = true; setBusy(true); setError(undefined);
    try {
      if (prepared.current?.files !== files) {
        const items: MemoryBatchInput['items'] = [];
        for (const [index, file] of files.entries()) {
          setMessage(`Conferindo arquivo ${index + 1} de ${files.length}…`);
          let description;
          try { description = await describeBatchFile(file); } catch { description = { name: file.name, size: file.size, checksum: null, delimiter: null }; }
          if (!live.current) return;
          items.push({ id: crypto.randomUUID(), file: description, input: { title: file.name.slice(0, 160), kind, authorized, metadata, primaryOrigin: null } });
        }
        prepared.current = { files, items };
      }
      const input = { title, items: prepared.current.items.map(item => ({ ...item, input: { ...item.input, kind, authorized } })) }, signature = JSON.stringify(input);
      if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
      setMessage('Salvando lote…'); const result = await port.createBatch(input, attempt.current.key);
      if (!live.current) return;
      onCreated(result, new Map(result.items.map((item, index) => [item.id, files[index]]))); setFiles([]); setTitle(''); prepared.current = undefined; attempt.current = undefined;
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível criar o lote.'); }
    finally { running.current = false; if (live.current) { setBusy(false); setMessage(''); } }
  };
  return <ResponsiveDialog open={open} title="Novo lote de documentos" onClose={onClose} dirty={Boolean(title || files.length)}
    footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!title.trim() || !files.length} onClick={() => void create()}>{message || 'Salvar lote'}</Button></>}>
    <Section>
      <LiveRegion message={message} />{error && <Alert tone="danger" title={error} />}
      <Field label="Nome do lote" required>{({ id }) => <Input id={id} maxLength={160} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} />}</Field>
      <Field label="Tipo dos documentos">{({ id }) => <Select id={id} disabled={busy} value={kind} options={MATERIAL_KINDS} onChange={value => setKind(value as typeof kind)} />}</Field>
      <Dropzone title="Escolher documentos" spec="Até 100 arquivos · TXT, MD, SRT, VTT, CSV ou TSV em UTF-8 · 1 MiB por arquivo" multiple accept=".txt,.md,.srt,.vtt,.csv,.tsv" maxSize={1048576} disabled={busy}
        onFiles={(accepted, rejected) => { const all = [...accepted, ...rejected.map(item => item.file)];
          if (all.length > 100) { setError('Selecione até 100 documentos por lote.'); return; } setFiles(all); setError(undefined); }} />
      {files.map((file, index) => <FileRow key={`${index}:${file.name}`} name={file.name} size={file.size} compact status="done" message="Selecionado para conferência"
        onRemove={busy ? undefined : () => setFiles(current => current.filter((_, at) => at !== index))} />)}
      <Checkbox label="Confirmo a autorização de uso destes documentos" disabled={busy} checked={authorized} onChange={event => setAuthorized(event.target.checked)} />
    </Section>
  </ResponsiveDialog>;
}
