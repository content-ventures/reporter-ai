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
    return { item, candidate };
  }, [batchId, itemId]);
  const resource = useMemoryResource(load, 3000), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const attempt = useRef<{ signature: string; key: string }>(undefined), running = useRef(false), live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const item = resource.data?.item, candidate = resource.data?.candidate;
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
  return <Section>
    <Alert tone="warning" title="O arquivo já aparece em outro material">Confira o contexto. Você também pode continuar depois em Importações.</Alert>
    {error && <Alert tone="danger" title={error} />}
    <DescriptionList items={[{ label: 'Novo título', value: item.input.title }, { label: 'Título existente', value: candidate.material.title },
      { label: 'Novo tipo', value: MATERIAL_KINDS.find(kind => kind.value === item.input.kind)?.label }, { label: 'Tipo existente', value: MATERIAL_KINDS.find(kind => kind.value === candidate.material.kind)?.label },
      { label: 'Nova edição', value: item.input.metadata.edition ?? 'Não informada' }, { label: 'Edição existente', value: candidate.material.metadata.edition ?? 'Não informada' },
      { label: 'Nova instituição', value: item.input.metadata.institution ?? 'Não informada' }, { label: 'Instituição existente', value: candidate.material.metadata.institution ?? 'Não informada' },
      { label: 'Nova empresa', value: item.input.metadata.company ?? 'Não informada' }, { label: 'Empresa existente', value: candidate.material.metadata.company ?? 'Não informada' },
      { label: 'Novo evento', value: item.input.metadata.event ?? 'Não informado' }, { label: 'Evento existente', value: candidate.material.metadata.event ?? 'Não informado' },
      { label: 'Nova publicação', value: item.input.metadata.publishedOn ?? 'Não informada' }, { label: 'Publicação existente', value: candidate.material.metadata.publishedOn ?? 'Não informada' },
      { label: 'Nova data da fala', value: item.input.metadata.recordedOn ?? 'Não informada' }, { label: 'Data da fala existente', value: candidate.material.metadata.recordedOn ?? 'Não informada' },
      { label: 'Novos temas', value: item.input.metadata.topics.join(', ') || 'Não informados' }, { label: 'Temas existentes', value: candidate.material.metadata.topics.join(', ') || 'Não informados' },
      { label: 'Nova URL', value: item.input.metadata.originalUrl ?? 'Não informada' }, { label: 'URL existente', value: candidate.material.metadata.originalUrl ?? 'Não informada' },
      { label: 'Versão do original existente', value: candidate.material.source.sourceVersion },
      { label: 'Nova origem', value: item.input.primaryOrigin ?? item.input.metadata.originalUrl ?? 'Não informada' }, { label: 'Origem existente', value: candidate.material.primaryOrigin.startsWith('text:') ? 'Não informada' : candidate.material.primaryOrigin },
      { label: 'Nova autorização', value: item.input.authorized ? 'Autorizada' : 'Não confirmada' }, { label: 'Autorização existente', value: candidate.source.rights.authorized ? 'Autorizada' : 'Não confirmada' }]} />
    <Field label="Motivo da decisão" required>{({ id }) => <Textarea id={id} rows={3} maxLength={2000} value={reason} disabled={busy} onChange={event => onReason(event.target.value)} />}</Field>
    <ButtonGroup label="Resolver correspondência"><Button disabled={!reason.trim()} loading={busy} onClick={() => void decide('reuse')}>Usar material existente</Button>
      <Button variant="secondary" disabled={!reason.trim()} loading={busy} onClick={() => void decide('distinct')}>Registrar material distinto</Button></ButtonGroup>
    <Button variant="ghost" disabled={busy} onClick={() => onOpenBatch(batchId)}>Abrir importação</Button>
  </Section>;
}
