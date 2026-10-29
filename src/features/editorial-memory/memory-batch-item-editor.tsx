'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, DescriptionList, Dropzone, Field, FieldGroup, FileRow, Input, LiveRegion, ResponsiveDialog, Section, Select, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import type { MemoryBatch, MemoryBatchItem } from '@/ports/editorial-memory-batch';
import type { MemoryMetadata } from '@/domain/editorial-memory';
import { MATERIAL_KINDS } from './memory-import-dialog';
import { describeBatchFile } from './memory-batch-files';

export function MemoryBatchItemEditor({ port, batch, item, open, onClose, onSaved }: { port: MemoryLibrary; batch: string; item: MemoryBatchItem;
  open: boolean; onClose: () => void; onSaved: (batch: MemoryBatch, file?: File) => void }) {
  const [basis, setBasis] = useState(item), [input, setInput] = useState(item.input), [file, setFile] = useState(item.file), [local, setLocal] = useState<File>();
  const [topics, setTopics] = useState(item.input.metadata.topics.join(', ')), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>(), [conflict, setConflict] = useState(false), [message, setMessage] = useState('');
  const live = useRef(true), attempt = useRef<{ signature: string; key: string }>(undefined), running = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const accepted = ['included', 'existing'].includes(basis.status);
  const changeMetadata = (key: keyof MemoryMetadata, value: string) => setInput(current => ({ ...current, metadata: { ...current.metadata,
    [key]: key === 'topics' ? value.split(',').map(topic => topic.trim()).filter(Boolean) : value || null } }));
  const save = async () => {
    if (running.current || accepted) return; running.current = true; setBusy(true); setError(undefined); setConflict(false);
    const value = { revision: basis.revision, input, file, reason }, signature = JSON.stringify(value);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    try { const result = await port.updateBatchItem(batch, item.id, value, attempt.current.key); if (live.current) onSaved(result, local); }
    catch (failure) { if (live.current) { setError(failure instanceof Error ? failure.message : 'Não foi possível revisar.'); setConflict((failure as { code?: string }).code === 'MEMORY_CONFLICT'); } }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  const refresh = async () => {
    setBusy(true);
    try { const current = (await port.batch(batch)).items.find(value => value.id === item.id); if (!current) throw new Error('O documento não está disponível.');
      if (live.current) { setBasis(current); setConflict(false); setError(undefined); } }
    catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar.'); }
    finally { if (live.current) setBusy(false); }
  };
  return <ResponsiveDialog open={open} title="Revisar documento do lote" onClose={onClose} dirty={Boolean(reason)} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={accepted || !reason.trim() || !input.title.trim()} onClick={() => void save()}>Salvar revisão</Button></>}>
    <Section>
      <LiveRegion message={message} />
      {error && <Alert tone="danger" title={error} action={conflict ? <Button disabled={busy} onClick={() => void refresh()}>Atualizar comparação</Button> : undefined} />}
      {accepted && <Alert tone="danger" title="Este documento já foi importado. Revise o material para corrigir seu conteúdo." />}
      <DescriptionList items={[{ label: 'Arquivo registrado', value: basis.file.name }, { label: 'Revisão registrada', value: basis.revision }, { label: 'Título registrado', value: basis.input.title }]} />
      <FileRow name={file.name} size={file.size} status="done" compact message="Arquivo proposto" />
      <Dropzone title="Escolher arquivo corrigido" spec="TXT, MD, SRT, VTT, CSV ou TSV em UTF-8 · até 1 MiB" accept=".txt,.md,.srt,.vtt,.csv,.tsv" maxSize={1048576} disabled={busy || accepted}
        onFiles={(files, rejected) => {
          if (rejected.length) { setError('Confira o formato e o limite de 1 MiB.'); return; }
          const selected = files[0]; if (!selected || running.current) return;
          running.current = true; setBusy(true); setMessage('Conferindo arquivo corrigido…');
          void describeBatchFile(selected).then(value => { if (live.current) { setFile(value); setLocal(selected); setError(undefined); } }, () => { if (live.current) setError('Não foi possível ler o arquivo. Escolha-o novamente.'); })
            .finally(() => { running.current = false; if (live.current) { setBusy(false); setMessage(''); } });
        }} />
      {/\.csv$/i.test(file.name) && <Field label="Separador do CSV">{({ id }) => <Select id={id} value={file.delimiter ?? ','} disabled={busy || accepted} onChange={value => setFile({ ...file, delimiter: value as typeof file.delimiter })}
        options={[{ value: ',', label: 'Vírgula' }, { value: ';', label: 'Ponto e vírgula' }, { value: '\t', label: 'Tabulação' }]} />}</Field>}
      <Field label="Título do documento" required>{({ id }) => <Input id={id} maxLength={160} disabled={busy || accepted} value={input.title} onChange={event => setInput({ ...input, title: event.target.value })} />}</Field>
      <Field label="Tipo do documento">{({ id }) => <Select id={id} value={input.kind} options={MATERIAL_KINDS} disabled={busy || accepted} onChange={value => setInput({ ...input, kind: value as typeof input.kind })} />}</Field>
      <Field label="Documento ou origem principal" optional>{({ id }) => <Input id={id} disabled={busy || accepted} value={input.primaryOrigin ?? ''} onChange={event => setInput({ ...input, primaryOrigin: event.target.value || null })} />}</Field>
      <FieldGroup label="Metadados do documento" columns={2}>
        {([{ key: 'originalUrl', label: 'URL original', type: 'url' }, { key: 'institution', label: 'Instituição' }, { key: 'company', label: 'Empresa' },
          { key: 'event', label: 'Evento' }, { key: 'edition', label: 'Edição' }, { key: 'publishedOn', label: 'Data de publicação', type: 'date' },
          { key: 'recordedOn', label: 'Data da fala', type: 'date' }, { key: 'publication', label: 'Nome da publicação' },
          { key: 'documentAuthor', label: 'Autor do documento' }, { key: 'documentSection', label: 'Página ou seção informada' }] as const).map(field => <Field key={field.key} label={field.label} optional>{({ id }) =>
          <Input id={id} type={'type' in field ? field.type : 'text'} disabled={busy || accepted} value={input.metadata[field.key] ?? ''} onChange={event => changeMetadata(field.key, event.target.value)} />}</Field>)}
        <Field label="Temas" optional>{({ id }) => <Input id={id} disabled={busy || accepted} value={topics} onChange={event => { setTopics(event.target.value); changeMetadata('topics', event.target.value); }} />}</Field>
      </FieldGroup>
      <Checkbox label="Confirmo a autorização de uso deste documento" disabled={busy || accepted} checked={input.authorized} onChange={event => setInput({ ...input, authorized: event.target.checked })} />
      <Field label="Motivo da revisão" required>{({ id }) => <Textarea id={id} rows={3} maxLength={2000} disabled={busy || accepted} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
    </Section>
  </ResponsiveDialog>;
}
