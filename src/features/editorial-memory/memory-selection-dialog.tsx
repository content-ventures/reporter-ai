'use client';
import { useCallback, useRef, useState } from 'react';
import { Alert, Button, Field, IconButton, Input, List, ListItem, Panel, ResponsiveDialog, Section, Spinner, toast } from '@content-ventures/design-system/v3';
import { X } from '@content-ventures/design-system/v3/icons';
import { memoryEvidenceRef, sameMemoryEvidence, type MemoryEvidenceRef, type MemorySelection } from '@/domain/editorial-memory';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, usePeople } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { useWorkspaceRouter } from '@/ui/workspace-navigation';
import { pieceHref } from '@/ui/routes';
import { BriefStep } from '@/features/new-production/brief-sections';
import { briefBlocker, EMPTY_DRAFT, MAX_TITLE_LENGTH, type NewProductionDraft } from '@/features/new-production/form';

type Props = { open: boolean; evidence: MemoryEvidenceRef[]; selection?: MemorySelection; onClose: () => void;
  onChange: (items: MemoryEvidenceRef[]) => void; onSaved: (selection: MemorySelection) => void };
type Attempt = { signature: string; saveKey: string; writeKey: string; selection?: MemorySelection };
export function MemorySelectionDialog({ open, evidence, selection, onClose, onChange, onSaved }: Props) {
  const router = useWorkspaceRouter(), canEdit = useCan('library.edit'), canCreate = useCan('production.create'), people = usePeople();
  const [draft, setDraft] = useState<NewProductionDraft>(() => ({ ...EMPTY_DRAFT, plan: 'article', origin: 'other' }));
  const [busy, setBusy] = useState<'save' | 'write'>(), [error, setError] = useState<string>();
  const titleRef = useRef<HTMLInputElement>(null), attempt = useRef<Attempt>(undefined), pending = useRef(false);
  const idsKey = JSON.stringify(evidence.map(item => item.id).sort());
  const load = useCallback(async (port: MemoryLibrary) => {
    const ids = JSON.parse(idsKey) as string[], items = [];
    // Bound concurrent reads when a selection spans many materials.
    for (let offset = 0; offset < ids.length; offset += 4) items.push(...await Promise.all(ids.slice(offset, offset + 4).map(id => port.detail(id))));
    return items;
  }, [idsKey]);
  const resource = useMemoryResource(load, 0, open), details = resource.data && evidence.map(ref => resource.data!.find(item => item.evidence.id === ref.id)!);
  const changed = details?.some((item, index) => !sameMemoryEvidence(evidence[index], memoryEvidenceRef(item.evidence)));
  const unavailable = details?.some(item => !item.eligibility.usable);
  const blocker = briefBlocker(draft);
  async function save(write: boolean) {
    if (!canEdit || !resource.port || pending.current || !details || !evidence.length || changed || unavailable) return;
    if (write && blocker) { setError(blocker); titleRef.current?.focus(); return; }
    pending.current = true; setBusy(write ? 'write' : 'save'); setError(undefined);
    const input = { title: draft.title.trim(), brief: { size: draft.size, sections: draft.sections, angle: draft.angle.trim() || undefined } };
    const signature = JSON.stringify({ evidence, input, id: selection?.id, revision: selection?.revision });
    if (attempt.current?.signature !== signature) attempt.current = { signature, saveKey: crypto.randomUUID(), writeKey: crypto.randomUUID() };
    const current = attempt.current;
    try {
      current.selection ??= await resource.port.select({ ...(selection ? { id: selection.id } : {}), baseRevision: selection?.revision ?? 0,
        productionId: selection?.productionId ?? null, evidence }, current.saveKey);
      if (write) {
        const created = await resource.port.writeSelection(current.selection.id, { ...input, baseRevision: current.selection.revision }, current.writeKey);
        onSaved(current.selection); onClose(); router.push(pieceHref(created.productionId, 'article'));
      } else { onSaved(current.selection); onClose(); toast('Seleção salva', { description: `${current.selection.items.length} evidências na ordem escolhida.` }); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível usar a seleção.'); }
    finally { pending.current = false; setBusy(undefined); }
  }
  const locked = Boolean(busy) || !canEdit, blocked = !details || !evidence.length || Boolean(changed || unavailable || resource.error);
  return <ResponsiveDialog open={open} title={canEdit ? 'Escrever com a seleção' : 'Seleção salva'} size="lg" dirty={Boolean(draft.title)} onClose={busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={Boolean(busy)} onClick={onClose}>Fechar</Button>{canEdit && <Button variant="secondary" loading={busy === 'save'} disabled={locked || blocked} onClick={() => void save(false)}>Salvar seleção</Button>}
      {canEdit && canCreate && <Button loading={busy === 'write'} disabled={locked || blocked || Boolean(blocker)} onClick={() => void save(true)}>Criar artigo e abrir editor</Button>}</>}>
    <Panel>
      <Section title={`${evidence.length} evidências na seleção`}>
        {(error || resource.error) && <Alert tone="danger" title={error ?? resource.error} />}
        {changed && <Alert tone="warning" title="Há evidências com nova revisão" action={<Button disabled={locked} onClick={() => onChange(details!.map(item => memoryEvidenceRef(item.evidence)))}>Atualizar seleção</Button>}>Confira os trechos atuais antes de continuar.</Alert>}
        {unavailable && <Alert tone="warning" title="Conclua a revisão das evidências ou remova os itens pendentes." />}
        {!details ? <Spinner label="Conferindo evidências selecionadas" /> : <List label="Ordem das evidências" maxHeight={280} onReorder={locked ? undefined : (from, to) => {
          const next = [...evidence], [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next);
        }}>
          {details.map((item, index) => <ListItem key={item.evidence.id} draggable={!locked} title={`${index + 1}. ${item.evidence.anchor.excerpt}`} titleLines={2}
            description={`${item.material.title} · ${item.evidence.kind === 'statistic' ? item.evidence.issuingInstitution ?? 'Instituição não informada' : people.data?.find(person => person.id === (item.evidence.kind === 'citation' ? item.evidence.personId : null))?.name ?? 'Autoria não identificada'}`}
            actions={<IconButton label={`Remover evidência ${index + 1}`} icon={X} disabled={locked} onClick={() => onChange(evidence.filter(ref => ref.id !== item.evidence.id))} />} />)}
        </List>}
      </Section>
      {canEdit && <Section>
        <Field label="Título interno" required>{({ id }) => <Input id={id} ref={titleRef} value={draft.title} maxLength={MAX_TITLE_LENGTH} disabled={locked} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />}</Field>
        <BriefStep existing draft={draft} update={patch => { if (!locked) setDraft(current => ({ ...current, ...patch })); }} titleRef={titleRef} />
      </Section>}
    </Panel>
  </ResponsiveDialog>;
}
