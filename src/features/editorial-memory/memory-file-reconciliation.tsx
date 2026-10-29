'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, DescriptionList, ErrorState, Field, Section, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { MATERIAL_KINDS } from './memory-material-kinds';

export function MemoryFileReconciliation({ port, batchId, itemId, reason, onReason, onDone, onOpenBatch }: { port: MemoryLibrary; batchId: string; itemId: string; reason: string; onReason: (value: string) => void; onDone: (id: string) => void; onOpenBatch: (id: string) => void }) {
  const load = useCallback(async (library: MemoryLibrary) => {
    const batch = await library.batch(batchId), item = batch.items.find(value => value.id === itemId);
    if (!item) throw new Error('Documento indisponível.');
    const candidate = item.candidate ? await library.material(item.candidate.id) : null;
    const original = candidate?.material.originalFileId ? await library.originalFile(candidate.material.originalFileId) : null;
    const latest = await library.batch(batchId), current = latest.items.find(value => value.id === itemId);
    if (!current) throw new Error('Documento indisponível.');
    if (!candidate || !current.candidate || current.candidate.id !== item.candidate?.id) return { item: current, candidate: null, original: null };
    const verified = await library.material(current.candidate.id);
    if (verified.material.originalFileId !== candidate.material.originalFileId) throw new Error('O material mudou. Atualize a correspondência.');
    return { item: current, candidate: verified, original };
  }, [batchId, itemId]);
  const resource = useMemoryResource(load, 3000), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const attempt = useRef<{ signature: string; key: string }>(undefined), running = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const item = resource.data?.item, candidate = resource.data?.candidate, original = resource.data?.original;
  const decide = async (choice: 'reuse' | 'distinct') => {
    if (running.current || resource.port !== port || !item?.candidate || !reason.trim()) return;
    const input = { revision: item.revision, decision: { choice, expected: item.candidate, reason: reason.trim() } };
    const signature = JSON.stringify(input); if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    running.current = true; setBusy(true); setError(undefined);
    try {
      const batch = await port.processBatchItem(batchId, itemId, input, attempt.current.key), resolved = batch.items.find(value => value.id === itemId);
      if (!live.current) return;
      if (!resolved?.materialId || !['included', 'existing'].includes(resolved.status)) throw new Error('A correspondência não está mais disponível.');
      onDone(resolved.materialId);
    } catch (failure) { if (live.current) setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a decisão.'); }
    finally { running.current = false; if (live.current) setBusy(false); }
  };
  if (!resource.port) return <Spinner label="Carregando correspondência" />;
  if (resource.port !== port) return <ErrorState title="Acesso alterado" description="Feche e abra a importação na conta atual." />;
  if (resource.error) return <ErrorState title="Não foi possível abrir a correspondência" description={resource.error} onRetry={resource.reload} />;
  if (!item) return <Spinner label="Carregando correspondência" />;
  if (['included', 'existing'].includes(item.status)) return <Section><Alert tone="success" title="Documento já resolvido" />
    {item.materialId && <Button onClick={() => onDone(item.materialId!)}>Abrir material</Button>}</Section>;
  if (!item.candidate || !candidate) return <ErrorState title="Correspondência indisponível" description="Abra a importação para revisar o documento novamente." actions={<Button onClick={() => onOpenBatch(batchId)}>Abrir importação</Button>} />;
  const name = (kind: string) => MATERIAL_KINDS.find(option => option.value === kind)?.label ?? kind;
  const separator = (value: string | null) => value === ',' ? 'Vírgula' : value === ';' ? 'Ponto e vírgula' : value === '\t' ? 'Tabulação' : 'Não informado';
  const format = (fileName: string) => ({ txt: 'text', md: 'markdown', srt: 'srt', vtt: 'vtt', csv: 'csv', tsv: 'tsv' } as Record<string, string>)[fileName.split('.').at(-1)?.toLowerCase() ?? ''];
  const displayFormat = (value: string | undefined) => value === 'text' ? 'TXT' : value === 'markdown' ? 'MD' : value?.toUpperCase() ?? 'Não informado';
  const newOrigin = item.input.primaryOrigin ?? item.input.metadata.originalUrl, oldOrigin = candidate.material.primaryOrigin.startsWith('text:') ? null : candidate.material.primaryOrigin;
  const currentSource = candidate.material.source, basis = item.candidate.source;
  const stale = candidate.material.revision !== item.candidate.revision || currentSource.kind !== basis.kind || currentSource.sourceId !== basis.sourceId
    || currentSource.sourceVersion !== basis.sourceVersion || currentSource.hash !== basis.hash;
  const pairs = [
    { label: 'Tipo', proposed: name(item.input.kind), current: name(candidate.material.kind) },
    { label: 'Edição', proposed: item.input.metadata.edition, current: candidate.material.metadata.edition },
    { label: 'Instituição', proposed: item.input.metadata.institution, current: candidate.material.metadata.institution },
    { label: 'Empresa', proposed: item.input.metadata.company, current: candidate.material.metadata.company },
    { label: 'Evento', proposed: item.input.metadata.event, current: candidate.material.metadata.event },
    { label: 'Publicação', proposed: item.input.metadata.publishedOn, current: candidate.material.metadata.publishedOn },
    { label: 'Data da fala', proposed: item.input.metadata.recordedOn, current: candidate.material.metadata.recordedOn },
    { label: 'Temas', proposed: item.input.metadata.topics.join(', ') || null, current: candidate.material.metadata.topics.join(', ') || null,
      differs: JSON.stringify(item.input.metadata.topics) !== JSON.stringify(candidate.material.metadata.topics) },
    { label: 'URL', proposed: item.input.metadata.originalUrl, current: candidate.material.metadata.originalUrl },
    { label: 'Origem', proposed: newOrigin, current: oldOrigin },
    { label: 'Autorização', proposed: item.input.authorized ? 'Autorizada' : 'Não confirmada', current: candidate.source.rights.authorized ? 'Autorizada' : 'Não confirmada' },
    { label: 'Formato', proposed: displayFormat(format(item.file.name)), current: displayFormat(original?.format) },
    { label: 'Separador', proposed: separator(item.file.delimiter), current: separator(original?.delimiter ?? null) },
  ];
  const differences = pairs.filter(pair => 'differs' in pair ? pair.differs : pair.proposed !== pair.current).flatMap(pair => [
    { label: `${pair.label} no envio`, value: pair.proposed ?? 'Não informado' }, { label: `${pair.label} existente`, value: pair.current ?? 'Não informado' },
  ]);
  return <Section>
    <Alert tone="warning" title="O arquivo já aparece em outro material">Confira o contexto. Você também pode continuar depois em Importações.</Alert>
    {stale && <Alert tone="warning" title="O material existente mudou">Abra a importação para atualizar a comparação antes de decidir.</Alert>}
    {error && <Alert tone="danger" title={error} />}
    <DescriptionList items={[{ label: 'Novo título', value: item.input.title }, { label: 'Título existente', value: candidate.material.title },
      { label: 'Arquivo enviado', value: item.file.name }, { label: 'Arquivo existente', value: original?.name ?? 'Não informado' }, ...differences,
      ...(candidate.material.source.sourceVersion !== 1 ? [{ label: 'Versão do original existente', value: candidate.material.source.sourceVersion }] : [])]} />
    <Field label="Motivo da decisão" required>{({ id }) => <Textarea id={id} rows={3} maxLength={2000} value={reason} disabled={busy} onChange={event => onReason(event.target.value)} />}</Field>
    <ButtonGroup label="Resolver correspondência"><Button disabled={!reason.trim() || stale} loading={busy} onClick={() => void decide('reuse')}>Usar material existente</Button>
      <Button variant="secondary" disabled={!reason.trim() || stale} loading={busy} onClick={() => void decide('distinct')}>Registrar material distinto</Button></ButtonGroup>
    <Button variant="ghost" disabled={busy} onClick={() => onOpenBatch(batchId)}>Abrir importação</Button>
  </Section>;
}
