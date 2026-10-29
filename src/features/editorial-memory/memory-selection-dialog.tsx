'use client';
import { useCallback, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, Field, IconButton, Input, List, ListItem, Panel, ResponsiveDialog, SearchField, Section, Select, Spinner, toast } from '@content-ventures/design-system/v3';
import { X } from '@content-ventures/design-system/v3/icons';
import { memoryEvidenceRef, sameMemoryEvidence, type MemoryEvidenceChoice, type MemorySelection } from '@/domain/editorial-memory';
import { updateMemoryChoice } from '@/domain/editorial-memory-discovery';
import type { MemoryLibrary, MemoryWritingInput } from '@/ports/editorial-memory';
import { useCan, usePeople, useProduction, useProductions } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { useWorkspaceRouter } from '@/ui/workspace-navigation';
import { pieceHref } from '@/ui/routes';
import { BriefStep } from '@/features/new-production/brief-sections';
import { briefBlocker, EMPTY_DRAFT, MAX_TITLE_LENGTH, type NewProductionDraft } from '@/features/new-production/form';
import { MemoryDiscoveryDetails } from './memory-discovery';
import { MemoryRelevanceDialog, type MemoryRelevanceBasis } from './memory-relevance-dialog';

type Props = { open: boolean; evidence: MemoryEvidenceChoice[]; selection?: MemorySelection; onClose: () => void;
  onChange: (items: MemoryEvidenceChoice[]) => void; onSaved: (selection: MemorySelection) => void };
type Attempt = { signature: string; saveKey: string; writeKey: string; selection?: MemorySelection; input?: MemoryWritingInput };
export function MemorySelectionDialog({ open, evidence, selection, onClose, onChange, onSaved }: Props) {
  const router = useWorkspaceRouter(), canEdit = useCan('library.edit'), canCreate = useCan('production.create'), canReview = useCan('library.review'), people = usePeople();
  const [rating, setRating] = useState<MemoryRelevanceBasis>(), [ratingOpen, setRatingOpen] = useState(false);
  const [draft, setDraft] = useState<NewProductionDraft>(() => ({ ...EMPTY_DRAFT, plan: 'article', origin: 'other' }));
  const [destination, setDestination] = useState<{ selectionId?: string; mode: 'new' | 'existing'; id: string }>();
  const chosen = destination?.selectionId === selection?.id ? destination : undefined;
  const mode = chosen?.mode ?? (selection?.productionId ? 'existing' : 'new'), targetId = mode === 'existing' ? chosen?.id ?? selection?.productionId ?? '' : '';
  const [targetSearch, setTargetSearch] = useState(''), [targetPage, setTargetPage] = useState(1);
  const targets = useProductions({ search: targetSearch }, { page: targetPage, size: 25 }), target = useProduction(open && targetId ? targetId : undefined);
  const choose = (nextMode: 'new' | 'existing', id = '') => setDestination({ selectionId: selection?.id, mode: nextMode, id });
  const [busy, setBusy] = useState<'save' | 'write'>(), [error, setError] = useState<string>();
  const [inspected, setInspected] = useState<string>();
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
  const discovery = evidence.find(item => item.id === inspected)?.discovery, discoveredMaterial = details?.find(item => item.evidence.id === inspected)?.material;
  const blocker = mode === 'new' ? briefBlocker(draft) : target.status !== 'ready' ? 'Escolha uma pauta disponível.'
    : target.data.production.archivedAt ? 'A pauta está arquivada.' : target.data.activeRuns.length ? 'Aguarde a geração antes de adicionar fontes.' : undefined;
  async function save(write: boolean) {
    if (!canEdit || !resource.port || pending.current || !details || !evidence.length || changed || unavailable) return;
    if (mode === 'existing' && blocker) { setError(blocker); return; }
    if (write && blocker) { setError(blocker); titleRef.current?.focus(); return; }
    pending.current = true; setBusy(write ? 'write' : 'save'); setError(undefined);
    const input: Omit<Extract<MemoryWritingInput, { title: string }>, 'baseRevision'> | Omit<Extract<MemoryWritingInput, { target: unknown }>, 'baseRevision'> = mode === 'existing'
      ? { target: { productionId: targetId, updatedAt: target.data!.production.updatedAt } }
      : { title: draft.title.trim(), brief: { size: draft.size, sections: draft.sections, angle: draft.angle.trim() || undefined } };
    const signature = JSON.stringify({ evidence, input: 'target' in input ? { target: input.target.productionId } : input, id: selection?.id, revision: selection?.revision });
    if (attempt.current?.signature !== signature) attempt.current = { signature, saveKey: crypto.randomUUID(), writeKey: crypto.randomUUID() };
    const current = attempt.current;
    try {
      const reusable = selection?.productionId === (targetId || null) ? selection : undefined;
      current.selection ??= await resource.port.select({ ...(reusable ? { id: reusable.id } : {}), baseRevision: reusable?.revision ?? 0,
        productionId: targetId || null, evidence }, current.saveKey);
      if (write) {
        current.input ??= { ...input, baseRevision: current.selection.revision };
        const created = await resource.port.writeSelection(current.selection.id, current.input, current.writeKey);
        onSaved(current.selection); onClose(); router.push(pieceHref(created.productionId, 'article'));
      } else { onSaved(current.selection); onClose(); toast('Seleção salva', { description: `${current.selection.items.length} evidências na ordem escolhida.` }); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível usar a seleção.'); }
    finally { pending.current = false; setBusy(undefined); }
  }
  const locked = Boolean(busy) || !canEdit, blocked = !details || !evidence.length || Boolean(changed || unavailable || resource.error);
  return <><ResponsiveDialog open={open} title={canEdit ? 'Escrever com a seleção' : 'Seleção salva'} size="lg" dirty={Boolean(draft.title)} onClose={busy ? () => undefined : () => { setRatingOpen(false); onClose(); }}
    footer={<><Button variant="ghost" disabled={Boolean(busy)} onClick={onClose}>Fechar</Button>{canEdit && <Button variant="secondary" loading={busy === 'save'} disabled={locked || blocked || mode === 'existing' && Boolean(blocker)} onClick={() => void save(false)}>Salvar seleção</Button>}
      {canEdit && canCreate && <Button loading={busy === 'write'} disabled={locked || blocked || Boolean(blocker)} onClick={() => void save(true)}>{mode === 'existing' ? 'Adicionar fontes e abrir editor' : 'Criar artigo e abrir editor'}</Button>}</>}>
    <Panel>
      <Section title={`${evidence.length} evidências na seleção`}>
        {(error || resource.error) && <Alert tone="danger" title={error ?? resource.error} action={mode === 'existing' ? <Button disabled={Boolean(busy)} onClick={() => { attempt.current = undefined; setError(undefined); target.retry(); resource.reload(); }}>Atualizar pauta</Button> : undefined} />}
        {changed && <Alert tone="warning" title="Há evidências com nova revisão" action={<Button disabled={locked} onClick={() => onChange(details!.map((item, index) => updateMemoryChoice(evidence[index], memoryEvidenceRef(item.evidence))))}>Atualizar seleção</Button>}>Confira os trechos atuais antes de continuar.</Alert>}
        {unavailable && <Alert tone="warning" title="Conclua a revisão das evidências ou remova os itens pendentes." />}
        {!details ? <Spinner label="Conferindo evidências selecionadas" /> : <List label="Ordem das evidências" maxHeight={280} onReorder={locked ? undefined : (from, to) => {
          const next = [...evidence], [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next);
        }}>
          {details.map((item, index) => <ListItem key={item.evidence.id} draggable={!locked} title={`${index + 1}. ${item.evidence.anchor.excerpt}`} titleLines={2}
            description={`${item.material.title} · ${item.evidence.kind === 'statistic' ? item.evidence.issuingInstitution ?? 'Instituição não informada' : people.data?.find(person => person.id === (item.evidence.kind === 'citation' ? item.evidence.personId : null))?.name ?? 'Autoria não identificada'}`}
            actions={<ButtonGroup label={`Ações da evidência ${index + 1}`}>
              {canReview && selection && resource.port && selection.items.some(saved => saved.evidence.id === item.evidence.id) && <Button size="sm" variant="ghost" disabled={Boolean(busy)} aria-label={`Avaliar relevância da evidência ${index + 1}`} onClick={() => {
                const port = resource.port!, input = { selection: { id: selection.id, revision: selection.revision }, evidence: selection.items.find(saved => saved.evidence.id === item.evidence.id)!.evidence };
                setRating(current => current?.port === port && JSON.stringify(current.input) === JSON.stringify(input) ? current : { key: crypto.randomUUID(), input, port }); setRatingOpen(true);
              }}>Avaliar relevância</Button>}
              {evidence[index].discovery && <Button size="sm" variant="ghost" aria-label={`Ver busca da evidência ${index + 1}`} aria-expanded={inspected === item.evidence.id}
                onClick={() => setInspected(inspected === item.evidence.id ? undefined : item.evidence.id)}>Ver busca</Button>}
              <IconButton label={`Remover evidência ${index + 1}`} icon={X} disabled={locked} onClick={() => onChange(evidence.filter(ref => ref.id !== item.evidence.id))} />
            </ButtonGroup>} />)}
        </List>}
      </Section>
      {discovery && <Section title="Busca original da evidência"><MemoryDiscoveryDetails discovery={discovery} material={discoveredMaterial} /></Section>}
      {canEdit && <Section>
        <Field label="Destino da seleção">{({ id }) => <Select id={id} value={mode} disabled={locked || Boolean(selection?.productionId)} options={[{ value: 'new', label: 'Novo artigo' }, { value: 'existing', label: 'Pauta existente' }]} onChange={value => choose(value as 'new' | 'existing')} />}</Field>
        {mode === 'existing' ? <>
          <SearchField label="Buscar pauta" value={targetSearch} disabled={locked} onValueChange={value => { setTargetSearch(value); setTargetPage(1); }} />
          {targets.error && <Alert tone="danger" title={targets.error.message} action={<Button onClick={targets.retry}>Tentar novamente</Button>} />}
          <Field label="Pauta de destino" required hint={blocker}>{({ id }) => <Select id={id} value={targetId} searchable loading={targets.status === 'loading'} disabled={locked || Boolean(selection?.productionId)}
            options={[{ value: '', label: 'Escolha uma pauta' }, ...(target.data && !targets.data?.items.some(item => item.id === targetId) ? [{ value: targetId, label: target.data.title,
              description: `${target.data.owner.name} · ${target.data.statusLabel} · ${new Date(target.data.updatedAt).toLocaleString('pt-BR')}` }] : []),
              ...(targets.data?.items ?? []).map(item => ({ value: item.id, label: item.title,
                description: `${item.owner.name} · ${item.statusLabel} · ${new Date(item.updatedAt).toLocaleString('pt-BR')}` }))]} onChange={id => choose('existing', id)} />}</Field>
          {target.error && <Alert tone="danger" title={target.error.message} action={<Button onClick={target.retry}>Atualizar pauta</Button>} />}
          {targets.data && targets.data.pageCount > 1 && <ButtonGroup label="Páginas de pautas">
            <Button variant="secondary" disabled={locked || targetPage <= 1} onClick={() => setTargetPage(page => page - 1)}>Pautas anteriores</Button>
            <Button variant="secondary" disabled={locked || targetPage >= targets.data.pageCount} onClick={() => setTargetPage(page => page + 1)}>Próximas pautas</Button>
          </ButtonGroup>}
        </> : <>
        <Field label="Título interno" required>{({ id }) => <Input id={id} ref={titleRef} value={draft.title} maxLength={MAX_TITLE_LENGTH} disabled={locked} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />}</Field>
        <BriefStep existing draft={draft} update={patch => { if (!locked) setDraft(current => ({ ...current, ...patch })); }} titleRef={titleRef} />
        </>}
      </Section>}
    </Panel>
  </ResponsiveDialog>
    {rating && <MemoryRelevanceDialog key={rating.key} basis={rating} open={open && ratingOpen} onClose={() => setRatingOpen(false)} onSaved={() => { setRatingOpen(false); toast('Feedback registrado'); }} />}
  </>;
}
