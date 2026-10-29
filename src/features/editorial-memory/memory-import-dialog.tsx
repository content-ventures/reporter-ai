'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Dropzone, Field, FieldGroup, FileRow, Input, LiveRegion, Radio, RadioGroup, ResponsiveDialog, Section, Select, Textarea } from '@content-ventures/design-system/v3';
import { readMemoryDocument, type MemoryDocumentDelimiter } from '@/domain/editorial-memory-document';
import { MAX_TEXT_BYTES } from '@/domain/reporter';
import type { MemoryMetadata } from '@/domain/editorial-memory';
import { contentHash } from '@/domain/text/hash';
import type { MemoryLibrary, MemoryImportInput } from '@/ports/editorial-memory';
import { MemoryFileReconciliation } from './memory-file-reconciliation';
import { MATERIAL_KINDS } from './memory-material-kinds';
export { MATERIAL_KINDS } from './memory-material-kinds';

type Props = { port: MemoryLibrary; open: boolean; onClose: () => void; onImported: (id: string) => void; onReviewBatch: (id: string) => void };
type Original = { name: string; bytes: Uint8Array };
const blankImport = (): MemoryImportInput => ({ title: '', kind: 'transcript', text: '', authorized: false, primaryOrigin: null, originalFileId: null,
  metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null } });

/** A retained dialog draft belongs to one authenticated workspace port. */
export function MemoryImportDialog(props: Props) {
  const binding = useMemo(() => ({ port: props.port, key: crypto.randomUUID() }), [props.port]);
  return <MemoryImportForm key={binding.key} {...props} />;
}
function MemoryImportForm({ port, open, onClose, onImported, onReviewBatch }: Props) {
  const modeName = useId();
  const [input, setInput] = useState<MemoryImportInput>(blankImport), [topicsText, setTopicsText] = useState('');
  const [mode, setMode] = useState<'text' | 'file'>('text'), [file, setFile] = useState<Original>();
  const [delimiter, setDelimiter] = useState<MemoryDocumentDelimiter>(','), [error, setError] = useState<string>();
  const [stored, setStored] = useState<{ file: Original; delimiter: MemoryDocumentDelimiter }>();
  const [phase, setPhase] = useState('');
  const [pending, setPending] = useState<{ batchId: string; itemId: string; contentFileId?: string }>();
  const [decisionReason, setDecisionReason] = useState('');
  const live = useRef(true), running = useRef(false);
  const upload = useRef<{ file: Original; delimiter: MemoryDocumentDelimiter; key: string; id?: string }>(undefined);
  const submission = useRef<{ payload: string; key: string }>(undefined);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const parsed = useMemo(() => file ? readMemoryDocument({ ...file, ...(/\.csv$/i.test(file.name) ? { delimiter } : {}) }) : undefined, [file, delimiter]);
  const originalText = mode === 'file' ? parsed?.ok ? parsed.value.text : '' : input.text;
  const busy = Boolean(phase);
  const setMetadata = (field: keyof MemoryMetadata, value: string) => setInput(current => ({ ...current, metadata: { ...current.metadata,
    [field]: field === 'topics' ? value.split(',').map(topic => topic.trim()).filter(Boolean) : value || null } }));
  const choose = async (selected: File) => {
    if (running.current) return;
    running.current = true; setPhase('Lendo arquivo…'); setError(undefined); setFile(undefined); upload.current = undefined;
    try { const bytes = new Uint8Array(await selected.arrayBuffer()); if (live.current) setFile({ name: selected.name, bytes }); }
    catch { if (live.current) setError('Não foi possível ler o arquivo. Escolha-o novamente.'); }
    finally { running.current = false; if (live.current) setPhase(''); }
  };
  const submit = async () => {
    if (running.current) return;
    running.current = true; setError(undefined); setPhase(mode === 'file' ? 'Enviando original…' : 'Importando material…');
    try {
      let originalFileId: string | undefined;
      if (mode === 'file') {
        if (!file || !parsed?.ok) return;
        if (upload.current?.file !== file || upload.current.delimiter !== delimiter) upload.current = { file, delimiter, key: crypto.randomUUID() };
        const attempt = upload.current;
        if (!attempt.id) {
          const original = await port.uploadOriginal({ ...file, ...(parsed.value.delimiter ? { delimiter: parsed.value.delimiter } : {}) }, attempt.key);
          if (!live.current) return;
          attempt.id = original.id; setStored({ file, delimiter });
        }
        originalFileId = attempt.id; setPhase('Importando material…');
      }
      const { text, originalFileId: unused, ...fields } = input;
      void unused;
      const command = originalFileId ? { ...fields, originalFileId } : { ...input, text };
      const payload = JSON.stringify(command);
      if (submission.current?.payload !== payload) submission.current = { payload, key: crypto.randomUUID() };
      const result = originalFileId ? await port.importFile({ ...fields, originalFileId }, submission.current.key) : await port.import(input, submission.current.key);
      if (!live.current) return;
      if ('pending' in result) { setPending({ ...result.pending, contentFileId: originalFileId }); return; }
      setInput(blankImport()); setTopicsText(''); setFile(undefined); upload.current = undefined; submission.current = undefined;
      onImported(result.material.id);
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível importar. Tente novamente.'); }
    finally { running.current = false; if (live.current) setPhase(''); }
  };
  const completed = (id: string) => { setPending(undefined); setDecisionReason(''); setInput(blankImport()); setTopicsText(''); setFile(undefined); upload.current = undefined; submission.current = undefined; onImported(id); };
  const leavePending = () => { setPending(undefined); setDecisionReason(''); setInput(blankImport()); setTopicsText(''); setFile(undefined); upload.current = undefined; submission.current = undefined; onClose(); };
  return <ResponsiveDialog open={open} title={pending ? 'Revisar correspondência' : 'Importar material'} dirty={Boolean(input.title || input.text || file)} onClose={onClose}
    footer={pending ? <Button variant="secondary" onClick={leavePending}>Continuar depois</Button> : <><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!input.title.trim() || originalText.trim().length < 24} onClick={() => void submit()}>{phase || 'Importar'}</Button></>}>
    {pending && open ? <MemoryFileReconciliation port={port} {...pending} contentOrigin={`text:${contentHash(originalText)}`} reason={decisionReason} onReason={setDecisionReason} onDone={completed} onOpenBatch={onReviewBatch} /> : !pending && <Section>
      <LiveRegion message={phase || (mode === 'file' && parsed && !parsed.ok ? parsed.refusal.message : '')} />
      {error && <Alert tone="danger" title={error} />}
      <RadioGroup legend="Formato de entrada" orientation="horizontal">
        <Radio name={modeName} value="text" label="Colar texto" checked={mode === 'text'} disabled={busy} onChange={() => setMode('text')} />
        <Radio name={modeName} value="file" label="Enviar arquivo" checked={mode === 'file'} disabled={busy} onChange={() => setMode('file')} />
      </RadioGroup>
      <Field label="Título" required>{({ id }) => <Input id={id} value={input.title} disabled={busy} maxLength={160} onChange={event => setInput({ ...input, title: event.target.value })} />}</Field>
      <Field label="Tipo">{({ id }) => <Select id={id} value={input.kind} disabled={busy} options={MATERIAL_KINDS} onChange={kind => setInput({ ...input, kind: kind as MemoryImportInput['kind'] })} />}</Field>
      {mode === 'file' && <>
        <Dropzone title="Escolher arquivo original" spec="TXT, MD, SRT, VTT, CSV ou TSV em UTF-8 · até 1 MiB" accept=".txt,.md,.srt,.vtt,.csv,.tsv" maxSize={MAX_TEXT_BYTES} disabled={busy}
          onFiles={(files, rejected) => {
            if (rejected.length) { setFile(undefined); upload.current = undefined; setError(rejected[0].reason === 'size' ? 'Divida o documento em arquivos de até 1 MiB.' : 'Escolha um arquivo TXT, MD, SRT, VTT, CSV ou TSV.'); }
            else if (files[0]) void choose(files[0]);
          }} />
        {file && <FileRow name={file.name} size={file.bytes.length} compact status={parsed?.ok ? 'done' : 'error'} message={parsed?.ok ? stored?.file === file && stored.delimiter === delimiter ? 'Original enviado' : 'Selecionado para envio' : parsed?.refusal.message}
          onRemove={busy ? undefined : () => { setFile(undefined); upload.current = undefined; }} />}
        {file && /\.csv$/i.test(file.name) && <Field label="Separador do CSV">{({ id }) => <Select id={id} value={delimiter} disabled={busy} onChange={value => setDelimiter(value as MemoryDocumentDelimiter)}
          options={[{ value: ',', label: 'Vírgula' }, { value: ';', label: 'Ponto e vírgula' }, { value: '\t', label: 'Tabulação' }]} />}</Field>}
      </>}
      <Field label={mode === 'file' ? 'Prévia do arquivo original' : 'Texto original'} required hint={mode === 'file' ? 'O arquivo será preservado com seus bytes originais.' : 'Até 1 MiB. O original será preservado integralmente.'}>{({ id, describedBy }) =>
        <Textarea id={id} aria-describedby={describedBy} rows={10} value={originalText} readOnly={mode === 'file'} disabled={busy} onChange={event => setInput({ ...input, text: event.target.value })} />}</Field>
      <Field label="Documento ou origem principal" optional hint="Use a mesma origem para partes ou republicações.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={busy} value={input.primaryOrigin ?? ''} onChange={event => setInput({ ...input, primaryOrigin: event.target.value || null })} />}</Field>
      <FieldGroup label="Origem" columns={2}>
        <Field label="URL original" optional>{({ id }) => <Input id={id} type="url" disabled={busy} value={input.metadata.originalUrl ?? ''} onChange={event => setMetadata('originalUrl', event.target.value)} />}</Field>
        <Field label="Instituição" optional>{({ id }) => <Input id={id} disabled={busy} value={input.metadata.institution ?? ''} onChange={event => setMetadata('institution', event.target.value)} />}</Field>
        <Field label="Data da fala" optional>{({ id }) => <Input id={id} type="date" disabled={busy} value={input.metadata.recordedOn ?? ''} onChange={event => setMetadata('recordedOn', event.target.value)} />}</Field>
        <Field label="Data de publicação" optional>{({ id }) => <Input id={id} type="date" disabled={busy} value={input.metadata.publishedOn ?? ''} onChange={event => setMetadata('publishedOn', event.target.value)} />}</Field>
        <Field label="Empresa" optional>{({ id }) => <Input id={id} disabled={busy} value={input.metadata.company ?? ''} onChange={event => setMetadata('company', event.target.value)} />}</Field>
        <Field label="Evento" optional>{({ id }) => <Input id={id} disabled={busy} value={input.metadata.event ?? ''} onChange={event => setMetadata('event', event.target.value)} />}</Field>
        <Field label="Edição" optional>{({ id }) => <Input id={id} disabled={busy} value={input.metadata.edition ?? ''} onChange={event => setMetadata('edition', event.target.value)} />}</Field>
        <Field label="Nome da publicação" optional>{({ id }) => <Input id={id} maxLength={240} disabled={busy} value={input.metadata.publication ?? ''} onChange={event => setMetadata('publication', event.target.value)} />}</Field>
        <Field label="Autor do documento" optional>{({ id }) => <Input id={id} maxLength={240} disabled={busy} value={input.metadata.documentAuthor ?? ''} onChange={event => setMetadata('documentAuthor', event.target.value)} />}</Field>
        <Field label="Página ou seção informada" optional>{({ id }) => <Input id={id} maxLength={240} disabled={busy} value={input.metadata.documentSection ?? ''} onChange={event => setMetadata('documentSection', event.target.value)} />}</Field>
        <Field label="Temas" optional>{({ id }) => <Input id={id} disabled={busy} value={topicsText} onChange={event => { setTopicsText(event.target.value); setMetadata('topics', event.target.value); }} />}</Field>
      </FieldGroup>
      <Checkbox label="Confirmo a autorização de uso deste material" checked={input.authorized} disabled={busy} onChange={event => setInput({ ...input, authorized: event.target.checked })} />
    </Section>}
  </ResponsiveDialog>;
}
