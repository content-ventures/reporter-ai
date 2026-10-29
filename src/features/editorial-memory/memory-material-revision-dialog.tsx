'use client';
import { useRef, useState } from 'react';
import { Alert, Button, DescriptionList, ErrorState, Field, FieldGroup, Grid, ResponsiveDialog, Section, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryMaterial } from '@/domain/editorial-memory';
import type { MemoryLibrary, MemoryMaterialRevisionResult } from '@/ports/editorial-memory';
import { contentHash } from '@/domain/text/hash';
import { useMemoryLibrary } from '@/state/use-memory-library';
import { useCan } from '@/state';

export type MaterialRevisionBasis = { key: string; material: MemoryMaterial; text: string; port: MemoryLibrary };
export function MemoryMaterialRevisionDialog({ basis, open, onClose, onSaved }: { basis: MaterialRevisionBasis; open: boolean; onClose: () => void; onSaved: (result: MemoryMaterialRevisionResult) => void }) {
  const port = useMemoryLibrary(), allowed = useCan('library.edit'), bound = port === basis.port;
  const [comparison, setComparison] = useState(basis), [text, setText] = useState(basis.text), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<{ message: string; conflict: boolean }>();
  const attempt = useRef<{ signature: string; key: string }>(undefined), pending = useRef(false);
  const locked = busy || !bound || !allowed;
  async function save() {
    if (!port || locked || pending.current || text === comparison.text || !reason.trim()) return;
    const input = { baseRevision: comparison.material.revision, source: comparison.material.source, text, reason: reason.trim() }, signature = contentHash(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError(undefined);
    try { onSaved(await port.reviseMaterial(comparison.material.id, input, attempt.current.key)); }
    catch (failure) { setError({ message: failure instanceof Error ? failure.message : 'Não foi possível revisar o original.', conflict: (failure as { code?: string }).code === 'MEMORY_CONFLICT' }); }
    finally { pending.current = false; setBusy(false); }
  }
  async function reloadComparison() {
    if (!port || locked || pending.current) return;
    setBusy(true);
    try {
      const current = await port.material(comparison.material.id);
      setComparison({ ...comparison, material: current.material, text: current.source.versions[0]?.content.segments.map(segment => segment.text).join('\n') ?? '', port });
      setError(undefined);
    } catch (failure) { setError({ message: failure instanceof Error ? failure.message : 'Não foi possível atualizar a comparação.', conflict: true }); }
    finally { setBusy(false); }
  }
  return <ResponsiveDialog open={open} title="Revisar original" size="lg" dirty={text !== comparison.text || Boolean(reason)} onClose={busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button><Button loading={busy} disabled={locked || text === comparison.text || text.trim().length < 24 || !reason.trim()} onClick={() => void save()}>Salvar nova versão</Button></>}>
    {!bound ? <ErrorState title="A conta mudou" description="Feche esta revisão e abra o material na conta atual." /> : <Section>
      {error && <Alert tone="danger" title={error.message} action={error.conflict ? <Button disabled={locked} onClick={() => void reloadComparison()}>Atualizar comparação</Button> : undefined} />}
      <DescriptionList items={[{ label: 'Material', value: comparison.material.title }, { label: 'Versão do original', value: comparison.material.source.sourceVersion }, { label: 'Revisão do material', value: comparison.material.revision }]} />
      <FieldGroup label="Comparação do original"><Grid columns="1:1" collapseBelow={480}>
        <Field label="Original em uso">{({ id }) => <Textarea id={id} readOnly rows={12} value={comparison.text} />}</Field>
        <Field label="Original revisado" required>{({ id }) => <Textarea id={id} disabled={locked} rows={12} value={text} onChange={event => setText(event.target.value)} />}</Field>
      </Grid></FieldGroup>
      <Field label="Motivo da revisão" required hint="A revisão inicia uma nova extração e exige conferir os usos existentes.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} disabled={locked} rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
    </Section>}
  </ResponsiveDialog>;
}
