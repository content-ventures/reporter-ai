'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, Checkbox, DescriptionList, EmptyState, ErrorState, Field, IconButton, List, ListItem, Panel, ResponsiveDialog, Section, Select, Spinner, Textarea, toast } from '@content-ventures/design-system/v3';
import { X } from '@content-ventures/design-system/v3/icons';
import type { Source } from '@/domain/source';
import { toSourceVersionRef } from '@/domain/source';
import type { MemoryDetail, MemoryLibrary, MemorySourceRefreshInput, MemorySourceRefreshResult } from '@/ports/editorial-memory';
import { useMemoryLibrary, useMemoryResource } from '@/state/use-memory-library';
import { useCan, usePeople } from '@/state';
import { currentRefreshItem, sameRefreshItem, type RefreshItem } from './memory-source-refresh-model';
import { ELIGIBILITY_LABELS } from './memory-evidence-detail';

export type MemoryRefreshBasis = { source: Source; target: MemorySourceRefreshInput['target']; port: MemoryLibrary };
type Attempt = { signature: string; selectionKey: string; refreshKey: string; input?: MemorySourceRefreshInput };
const errorText = (error: unknown, fallback: string) => error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.message : fallback;
export function MemorySourceRefreshDialog({ basis, writable, onClose, onDone }: { basis: MemoryRefreshBasis; writable: boolean; onClose: () => void; onDone: (result: MemorySourceRefreshResult) => void }) {
  const port = useMemoryLibrary(), canLibrary = useCan('library.edit'), canProduction = useCan('production.edit'), canPiece = useCan('piece.edit'), people = usePeople();
  const bound = port === basis.port && writable && canLibrary && canProduction && canPiece;
  const source = basis.source, receipt = source.memory!.at(-1), retired = receipt?.retired === true;
  const original = source.memory!.findLast(item => !item.retired)?.items ?? [];
  const [items, setItems] = useState<RefreshItem[]>(() => original.map(item => item.selected));
  const [readIds, setReadIds] = useState(() => original.map(item => item.selected.evidence.id));
  const [chosenOption, setChosenOption] = useState<{ value: string; label: string; description: string }>();
  const [mode, setMode] = useState('refresh'), [origin, setOrigin] = useState('source'), [chosen, setChosen] = useState('');
  const [reason, setReason] = useState(''), [rebase, setRebase] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [staleContext, setStaleContext] = useState(false);
  const [writing, setWriting] = useState(false);
  const [inspected, setInspected] = useState<string>(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const pending = useRef(false), attempt = useRef<Attempt>(undefined), binding = useRef(port);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>()), focusAfterRemove = useRef<string | null | undefined>(undefined), reasonInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { binding.current = bound ? port : undefined; return () => { binding.current = undefined; }; }, [port, bound]);
  useEffect(() => {
    const id = focusAfterRemove.current; focusAfterRemove.current = undefined;
    if (id !== undefined) (id === null ? reasonInput.current : removeButtons.current.get(id))?.focus();
  }, [items]);
  const idsKey = JSON.stringify([...readIds].sort());
  const readDetails = useCallback(async (library: MemoryLibrary) => {
    const ids = JSON.parse(idsKey) as string[], rows: { id: string; detail?: MemoryDetail; error?: string }[] = [];
    for (let offset = 0; offset < ids.length; offset += 4) rows.push(...await Promise.all(ids.slice(offset, offset + 4).map(async id => {
      try { return { id, detail: await library.detail(id) }; }
      catch (failure) { return { id, error: errorText(failure, 'Não foi possível conferir esta evidência.') }; }
    })));
    return rows;
  }, [idsKey]);
  const details = useMemoryResource(readDetails, 0, bound && mode === 'refresh');
  const cursor = cursors.at(-1), readSelections = useCallback((library: MemoryLibrary) => library.selections({ cursor, limit: 25 }), [cursor]);
  const selections = useMemoryResource(readSelections, 0, bound && mode === 'refresh' && origin === 'saved');
  const rows = items.map(item => ({ item, ...details.data?.find(row => row.id === item.evidence.id) }));
  const unavailable = rows.some(row => !row.detail?.eligibility.usable), stale = rows.some(row => row.detail && !sameRefreshItem(row.item, currentRefreshItem(row.detail)));
  const locked = busy || !bound, blocked = !reason.trim() || !bound || staleContext || mode === 'refresh' && (!items.length || !details.data || unavailable || stale || Boolean(details.error));
  const inspectedRow = rows.find(row => row.item.evidence.id === inspected), previous = original.find(item => item.selected.evidence.id === inspected);
  const inspectedAuthor = inspectedRow?.detail?.evidence.kind === 'citation' ? inspectedRow.detail.evidence.personId : null;
  async function chooseSelection(id: string) {
    if (!bound || pending.current || !id) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const selected = await basis.port.selection(id);
      if (binding.current !== basis.port) return;
      if (selected.productionId !== null && selected.productionId !== basis.target.productionId) { setError('Escolha uma seleção desta pauta ou sem destino.'); return; }
      setChosen(id); setChosenOption({ value: id, label: `${selected.items.length} evidências · ${new Date(selected.updatedAt).toLocaleString('pt-BR')}`, description: `Revisão ${selected.revision}` });
      setItems(selected.items); setReadIds(selected.items.map(item => item.evidence.id)); setInspected(undefined);
    } catch (failure) { if (binding.current === basis.port) setError(errorText(failure, 'Não foi possível abrir a seleção.')); }
    finally { pending.current = false; if (binding.current === basis.port) { setBusy(false); setWriting(false); } }
  }
  async function save() {
    if (pending.current || blocked) return;
    const signature = JSON.stringify({ items, mode, reason: reason.trim(), rebase, target: basis.target, expected: toSourceVersionRef(source) });
    if (attempt.current?.signature !== signature) attempt.current = { signature, selectionKey: crypto.randomUUID(), refreshKey: crypto.randomUUID() };
    const current = attempt.current;
    pending.current = true; setBusy(true); setWriting(true); setError(undefined);
    try {
      if (!current.input) {
        const selected = mode === 'refresh' ? await basis.port.select({ productionId: basis.target.productionId, baseRevision: 0, evidence: items.map(item => item.evidence) }, current.selectionKey) : null;
        if (binding.current !== basis.port) return;
        if (selected && (selected.items.length !== items.length || selected.items.some((item, index) => !sameRefreshItem(item, items[index])))) {
          details.reload(); setError('A revisão mudou enquanto a seleção era salva. Confira as evidências novamente.'); return;
        }
        current.input = { target: basis.target, expected: toSourceVersionRef(source), selection: selected ? { id: selected.id, revision: selected.revision } : null,
          updateDraftReferences: mode === 'refresh' && rebase, reason: reason.trim() };
      }
      const result = await basis.port.refreshSource(source.id, current.input, current.refreshKey);
      if (binding.current !== basis.port) return;
      const concerns = new Set(result.concerns.map(item => item.blockId)).size;
      toast(result.retired ? 'Fonte retirada das novas gerações' : 'Fonte atualizada', { description: concerns ? `${concerns} ${concerns === 1 ? 'trecho mantido' : 'trechos mantidos'} para revisão.` : undefined });
      onDone(result);
    } catch (failure) { if (binding.current === basis.port) { setError(errorText(failure, 'Não foi possível confirmar a atualização. Tente novamente.')); setStaleContext((failure as { code?: string })?.code === 'MEMORY_CONFLICT'); } }
    finally { pending.current = false; if (binding.current === basis.port) { setBusy(false); setWriting(false); } }
  }
  return <ResponsiveDialog open title={retired ? 'Reativar fonte' : 'Atualizar fonte'} size="lg" dirty={Boolean(reason.trim()) || rebase || mode === 'retire'} dismissible={!writing || !bound}
    onClose={writing && bound ? () => undefined : onClose} footer={<><Button variant="ghost" disabled={writing && bound} onClick={onClose}>Fechar</Button>
      {bound && <Button loading={writing} disabled={blocked || busy} onClick={() => void save()}>{mode === 'retire' ? 'Retirar fonte' : retired ? 'Reativar fonte' : 'Atualizar fonte'}</Button>}</>}>
    {!bound ? <ErrorState title="A edição não está disponível" description="Feche este diálogo e confira a fonte e suas permissões na conta atual." /> : <Panel>
      <Section>
        {error && <Alert tone="danger" title={error} action={<Button disabled={busy} onClick={staleContext ? onClose : () => { details.reload(); selections.reload(); }}>{staleContext ? 'Fechar e conferir fonte' : 'Conferir novamente'}</Button>} />}
        <Field label="Ação">{({ id }) => <Select id={id} value={mode} disabled={locked} options={[{ value: 'refresh', label: retired ? 'Reativar com evidências revisadas' : 'Atualizar evidências' }, ...(!retired ? [{ value: 'retire', label: 'Retirar das novas gerações' }] : [])]} onChange={setMode} />}</Field>
        {mode === 'retire' ? <Alert tone="warning" title="O rascunho e as versões anteriores serão preservados">As evidências desta fonte deixam de alimentar novas gerações. Trechos já usados podem precisar de revisão.</Alert> : <>
          <Field label="Evidências de origem">{({ id }) => <Select id={id} value={origin} disabled={locked} options={[{ value: 'source', label: 'Itens desta fonte' }, { value: 'saved', label: 'Seleção salva' }]}
            onChange={value => { setOrigin(value); setChosen(''); setChosenOption(undefined); setItems(value === 'source' ? original.map(item => item.selected) : []); setReadIds(value === 'source' ? original.map(item => item.selected.evidence.id) : []); setInspected(undefined); }} />}</Field>
          {origin === 'saved' && <>
            <Field label="Seleção salva">{({ id }) => <Select id={id} value={chosen} loading={!selections.data} disabled={locked} options={[{ value: '', label: 'Escolha uma seleção' }, ...(chosenOption && !selections.data?.items.some(item => item.id === chosen) ? [chosenOption] : []), ...(selections.data?.items ?? []).filter(item => item.productionId === null || item.productionId === basis.target.productionId).map(item => ({ value: item.id,
              label: `${item.items.length} evidências · ${new Date(item.updatedAt).toLocaleString('pt-BR')}`, description: `Revisão ${item.revision} · ${people.data?.find(person => person.id === item.updatedBy)?.name ?? 'Usuário do cliente'}` }))]} onChange={id => void chooseSelection(id)} />}</Field>
            {selections.error && <Alert tone="danger" title={selections.error} action={<Button onClick={selections.reload}>Tentar novamente</Button>} />}
            <ButtonGroup label="Páginas de seleções"><Button variant="secondary" disabled={locked || cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Seleções anteriores</Button>
              <Button variant="secondary" disabled={locked || !selections.data?.nextCursor} onClick={() => setCursors(current => [...current, selections.data!.nextCursor!])}>Próximas seleções</Button></ButtonGroup>
          </>}
          {details.error && <Alert tone="danger" title={details.error} action={<Button onClick={details.reload}>Tentar novamente</Button>} />}
          {stale && <Alert tone="warning" title="Confira as revisões atualizadas antes de continuar" />}
          {unavailable && details.data && <Alert tone="warning" title="Remova as evidências indisponíveis ou conclua a revisão no banco" action={<Button disabled={locked} onClick={details.reload}>Conferir evidências</Button>} />}
          {!items.length && origin === 'source' ? <EmptyState size="panel" title="Selecione evidências para a nova versão" description="Escolha uma seleção salva ou retire a fonte das novas gerações." />
          : !details.data && items.length ? <Spinner label="Conferindo as evidências" /> : <List label="Evidências da nova versão" maxHeight={300} onReorder={locked ? undefined : (from, to) => { const next = [...items], [item] = next.splice(from, 1); next.splice(to, 0, item); setItems(next); }}>
            {rows.map(({ item, detail, error }, index) => <ListItem key={item.evidence.id} draggable={!locked} selected={inspected === item.evidence.id} title={`${index + 1}. ${detail?.evidence.anchor.excerpt ?? original.find(old => old.selected.evidence.id === item.evidence.id)?.anchor.excerpt ?? 'Evidência indisponível'}`} titleLines={2}
              description={detail ? `${detail.material.title} · revisão ${detail.evidence.revision} · ${ELIGIBILITY_LABELS[detail.eligibility.reason]}` : error}
              onClick={() => setInspected(item.evidence.id)} actions={<ButtonGroup label={`Ações da evidência ${index + 1}`}>
                {detail && !sameRefreshItem(item, currentRefreshItem(detail)) && <Button size="sm" variant="secondary" disabled={locked || !detail.eligibility.usable} onClick={() => setItems(current => current.map(pin => pin.evidence.id === item.evidence.id ? currentRefreshItem(detail) : pin))}>Usar revisão atual</Button>}
                <IconButton ref={element => { if (element) removeButtons.current.set(item.evidence.id, element); else removeButtons.current.delete(item.evidence.id); }}
                  label={`Remover evidência ${index + 1}`} icon={X} disabled={locked} onClick={() => { const next = items.filter(pin => pin.evidence.id !== item.evidence.id); focusAfterRemove.current = next[Math.min(index, next.length - 1)]?.evidence.id ?? null; setItems(next); }} />
              </ButtonGroup>} />)}
          </List>}
          <Checkbox label="Atualizar referências sem alterar o texto" description="Somente evidências com o mesmo conteúdo serão reapontadas. Trechos alterados continuam para revisão." checked={rebase} disabled={locked} onChange={event => setRebase(event.target.checked)} />
        </>}
        <Field label="Motivo" required>{({ id }) => <Textarea id={id} ref={reasonInput} value={reason} maxLength={2000} disabled={locked} onChange={event => setReason(event.target.value)} />}</Field>
      </Section>
      {mode === 'refresh' && inspectedRow && <Section title="Conferência da evidência">
        {previous && <Field label="Trecho na fonte anterior">{({ id }) => <Textarea id={id} readOnly value={previous.anchor.excerpt} />}</Field>}
        {inspectedRow.detail ? <><Field label="Trecho atual">{({ id }) => <Textarea id={id} readOnly value={inspectedRow.detail!.evidence.anchor.excerpt} />}</Field>
          <DescriptionList items={[
            ...(inspectedRow.detail.evidence.kind === 'citation' ? [{ label: 'Autoria atual', value: people.data?.find(person => person.id === inspectedAuthor)?.name ?? 'Autoria não identificada' }]
              : [{ label: 'Instituição emissora', value: inspectedRow.detail.evidence.issuingInstitution ?? inspectedRow.detail.evidence.metadata.institution ?? 'Não informada' },
                { label: 'Valor original', value: inspectedRow.detail.evidence.value.raw }, { label: 'Unidade', value: inspectedRow.detail.evidence.unit }, { label: 'Período', value: inspectedRow.detail.evidence.period?.label ?? 'Não informado' }]),
            { label: 'Política', value: `Revisão ${inspectedRow.detail.policy.revision}` }, { label: 'Decisão', value: inspectedRow.detail.decision ? `${({ accept: 'Aceita', reject: 'Rejeitada', request_revision: 'Revisão solicitada' })[inspectedRow.detail.decision.action]} · ${new Date(inspectedRow.detail.decision.at).toLocaleString('pt-BR')}` : 'Sem decisão' },
            ...(inspectedRow.detail.decision ? [{ label: 'Revisada por', value: people.data?.find(person => person.id === inspectedRow.detail!.decision?.personId)?.name ?? 'Usuário do cliente' }, { label: 'Motivo da decisão', value: inspectedRow.detail.decision.reason }] : []),
          ]} /></>
          : <Alert tone="warning" title={inspectedRow.error ?? 'Evidência indisponível'} />}
      </Section>}
    </Panel>}
  </ResponsiveDialog>;
}
