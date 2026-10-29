'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, DescriptionList, ErrorState, Field, ResponsiveDialog, Section, Select, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryRelevanceInput } from '@/domain/editorial-memory-feedback';
import { contentHash } from '@/domain/text/hash';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan } from '@/state';
import { useMemoryLibrary, useMemoryResource } from '@/state/use-memory-library';
import { MemoryDiscoveryDetails } from './memory-discovery';

export type MemoryRelevanceBasis = { key: string; input: Pick<MemoryRelevanceInput, 'selection' | 'evidence'>; port: MemoryLibrary };
export function MemoryRelevanceDialog({ basis, open, onClose, onSaved }: { basis: MemoryRelevanceBasis; open: boolean; onClose: () => void; onSaved: () => void }) {
  const port = useMemoryLibrary(), canReview = useCan('library.review'), bound = port === basis.port;
  const load = useCallback((library: MemoryLibrary) => library.relevanceContext(basis.input), [basis.input]), resource = useMemoryResource(load, 0, open && bound && canReview);
  const [rating, setRating] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const active = useRef(false), pending = useRef(false), attempt = useRef<{ signature: string; key: string }>(undefined);
  useLayoutEffect(() => { active.current = open && bound && canReview; return () => { active.current = false; }; }, [open, bound, canReview]);
  const locked = busy || !bound || !canReview, context = resource.data;
  async function save() {
    if (!port || locked || pending.current || !context || !rating || !reason.trim()) return;
    const input: MemoryRelevanceInput = { ...basis.input, rating: rating as MemoryRelevanceInput['rating'], reason: reason.trim() }, signature = contentHash(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError(undefined);
    try { await port.rateRelevance(input, attempt.current.key); if (active.current) onSaved(); }
    catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a avaliação.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <ResponsiveDialog open={open} title="Avaliar relevância" size="lg" dirty={Boolean(rating || reason)} onClose={busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button><Button loading={busy} disabled={locked || !context || !rating || !reason.trim() || Boolean(resource.error)} onClick={() => void save()}>Registrar avaliação</Button></>}>
    {!bound || !canReview ? <ErrorState title="Acesso alterado" description="Feche esta avaliação e abra a seleção na conta atual." /> : resource.error ? <ErrorState title="Não foi possível abrir a seleção original" description={resource.error} onRetry={resource.reload} /> : !context ? <Spinner label="Carregando seleção original" /> : <Section>
      {error && <Alert tone="danger" title={error} />}
      <Textarea aria-label="Trecho avaliado na seleção" readOnly rows={6} value={context.evidence.anchor.excerpt} />
      <DescriptionList items={[{ label: 'Material', value: context.material.title }, { label: 'Versão do original', value: context.source.sourceVersion },
        { label: 'Revisão da evidência', value: context.evidence.revision }, { label: 'Revisão da seleção', value: context.selection.revision },
        ...(context.productionTitle ? [{ label: 'Pauta', value: context.productionTitle }] : [])]} />
      {context.item.discovery && <MemoryDiscoveryDetails discovery={context.item.discovery} material={context.material} />}
      <Field label="Utilidade para a pauta" required>{({ id }) => <Select id={id} value={rating} disabled={locked} options={[{ value: '', label: 'Escolha uma avaliação' }, { value: 'useful', label: 'Útil para a pauta' }, { value: 'not_useful', label: 'Não foi útil para a pauta' }]} onChange={setRating} />}</Field>
      <Field label="Motivo da avaliação" required hint="Esta avaliação não altera a revisão factual da evidência.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={2000} disabled={locked} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
    </Section>}
  </ResponsiveDialog>;
}
