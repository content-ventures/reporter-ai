'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, DataTable, DescriptionList, EmptyState, ErrorState, Field, Grid, ResponsiveDialog, SearchField, Section, Spinner, Textarea } from '@content-ventures/design-system/v3';
import { memoryEvidenceRef, type MemoryEvidence } from '@/domain/editorial-memory';
import { contentHash } from '@/domain/text/hash';
import type { MemoryDetail, MemoryLibrary, MemoryReplacementResult } from '@/ports/editorial-memory';
import { useCan, useSession } from '@/state';
import { useMemoryLibrary, useMemoryResource } from '@/state/use-memory-library';

export type MemoryReplacementBasis = { key: string; previous: MemoryDetail; port: MemoryLibrary };
function compatible(previous: MemoryEvidence, current: MemoryEvidence) {
  return previous.id !== current.id && previous.kind === current.kind && previous.status === 'active' && current.status === 'active'
    && previous.deduplication?.state !== 'pending' && current.deduplication?.state !== 'pending'
    && (previous.kind !== 'citation' || previous.anchor.source.sourceId === current.anchor.source.sourceId && previous.anchor.source.sourceVersion < current.anchor.source.sourceVersion);
}
function Observation({ evidence, title, material }: { evidence: MemoryEvidence; title: string; material: string }) {
  return <Section title={title} titleAs="h3">
    <Textarea aria-label={`Trecho ${title.toLocaleLowerCase('pt-BR')}`} readOnly value={evidence.anchor.excerpt} rows={6} />
    <DescriptionList items={[{ label: 'Material', value: material }, { label: 'Versão do original', value: evidence.anchor.source.sourceVersion },
      { label: 'Revisão da evidência', value: evidence.revision },
      ...(evidence.kind === 'statistic' ? [{ label: 'Valor', value: evidence.value.raw }, { label: 'Unidade', value: evidence.unit }, { label: 'Período', value: evidence.period?.label ?? 'Não informado' },
        ...(evidence.qualifier ? [{ label: 'Ressalva', value: evidence.qualifier }] : []), ...(evidence.geography ? [{ label: 'Geografia', value: evidence.geography }] : []),
        ...(evidence.population ? [{ label: 'População', value: evidence.population }] : [])] : [])]} />
  </Section>;
}
export function MemoryReplacementDialog({ basis, open, onClose, onSaved }: { basis: MemoryReplacementBasis; open: boolean; onClose: () => void; onSaved: (result: MemoryReplacementResult) => void }) {
  const port = useMemoryLibrary(), allowed = useCan('library.edit'), bound = port === basis.port;
  const [previous, setPrevious] = useState(basis.previous), [chosen, setChosen] = useState<MemoryDetail>();
  const [query, setQuery] = useState(''), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [page, setPage] = useState(0);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<{ message: string; conflict: boolean }>();
  const pending = useRef(false), active = useRef(false), attempt = useRef<{ signature: string; key: string }>(undefined);
  useLayoutEffect(() => { active.current = open && bound && allowed; return () => { active.current = false; }; }, [open, bound, allowed]);
  const cursor = cursors[page], kind = previous.evidence.kind;
  const load = useCallback((library: MemoryLibrary) => library.query({ kind, status: 'active', query, cursor, limit: 25 }), [kind, query, cursor]);
  const candidates = useMemoryResource(load, 0, open && bound && allowed), locked = busy || !bound || !allowed;
  const valid = chosen && compatible(previous.evidence, chosen.evidence) && !previous.replacements?.next && !chosen.replacements?.previous
    && chosen.source.authorized && chosen.eligibility.reason !== 'source_unavailable';
  async function choose(id: string) {
    if (!port || locked || pending.current) return;
    pending.current = true; setBusy(true); setError(undefined);
    try { const detail = await port.detail(id); if (active.current) setChosen(detail); }
    catch (failure) { if (active.current) setError({ message: failure instanceof Error ? failure.message : 'Não foi possível abrir o registro.', conflict: false }); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh() {
    if (!port || locked || pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const [old, current] = await Promise.all([port.detail(previous.evidence.id), chosen ? port.detail(chosen.evidence.id) : Promise.resolve(undefined)]);
      if (active.current) { setPrevious(old); setChosen(current); setError(undefined); setCursors([undefined]); setPage(0); candidates.reload(); }
    } catch (failure) { if (active.current) setError({ message: failure instanceof Error ? failure.message : 'Não foi possível atualizar a comparação.', conflict: true }); }
    finally { pending.current = false; setBusy(false); }
  }
  async function save() {
    if (!port || locked || pending.current || !chosen || !valid || !reason.trim() || error?.conflict) return;
    const input = { expected: memoryEvidenceRef(previous.evidence), replacement: memoryEvidenceRef(chosen.evidence), reason: reason.trim() }, signature = contentHash(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    pending.current = true; setBusy(true); setError(undefined);
    try { const result = await port.replace(previous.evidence.id, input, attempt.current.key); if (active.current) onSaved(result); }
    catch (failure) { if (active.current) setError({ message: failure instanceof Error ? failure.message : 'Não foi possível registrar a substituição.', conflict: (failure as { code?: string }).code === 'MEMORY_CONFLICT' }); }
    finally { pending.current = false; setBusy(false); }
  }
  return <ResponsiveDialog open={open} size="lg" title="Substituir evidência" dirty={Boolean(reason || chosen)} onClose={busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>Fechar</Button><Button loading={busy} disabled={locked || !valid || !reason.trim() || error?.conflict} onClick={() => void save()}>Registrar substituição</Button></>}>
    {!bound || !allowed ? <ErrorState title="Acesso alterado" description="Feche esta substituição e abra a evidência na conta atual." /> : <Section>
      {error && <Alert tone="danger" title={error.message} action={error.conflict ? <Button disabled={locked} onClick={() => void refresh()}>Atualizar comparação</Button> : undefined} />}
      {chosen ? <>
        <Grid columns="1:1" collapseBelow={480}><Observation title="Registro anterior" evidence={previous.evidence} material={previous.material.title} /><Observation title="Registro substituto" evidence={chosen.evidence} material={chosen.material.title} /></Grid>
        {!valid && <Alert tone="warning" title="Este par não pode ser substituído">Confira a versão atual, o original e as substituições já registradas.</Alert>}
        <Button variant="secondary" disabled={locked} onClick={() => setChosen(undefined)}>Escolher outro registro</Button>
      </> : <>
        <SearchField label="Buscar registro substituto" value={query} disabled={locked} onValueChange={value => { setQuery(value); setCursors([undefined]); setPage(0); }} />
        {candidates.error ? <ErrorState title="Não foi possível buscar registros" description={candidates.error} actions={<Button disabled={locked} onClick={() => { setPage(0); setCursors([undefined]); candidates.reload(); }}>Atualizar consulta</Button>} /> : !candidates.data ? <Spinner label="Buscando registros" /> : <DataTable label="Registros substitutos" rows={candidates.data.items.filter(item => compatible(previous.evidence, item.evidence))} rowKey={item => item.evidence.id}
          rowLabel={item => item.evidence.anchor.excerpt.slice(0, 80)} onRowClick={locked ? undefined : item => void choose(item.evidence.id)}
          columns={[{ key: 'text', header: 'Evidência', pinned: true, render: item => item.evidence.anchor.excerpt.slice(0, 180) }, { key: 'material', header: 'Material', render: item => item.material.title }, { key: 'version', header: 'Original', render: item => `Versão ${item.evidence.anchor.source.sourceVersion}` }]}
          empty={<EmptyState title="Nenhum substituto nesta página" description={kind === 'citation' ? 'Extraia a citação de uma versão mais recente do mesmo original.' : 'Busque outra observação ou importe um novo material.'} />}
          footer={<ButtonGroup label="Páginas dos registros"><Button variant="secondary" disabled={locked || page === 0} onClick={() => setPage(value => value - 1)}>Anterior</Button><Button variant="secondary" disabled={locked || !candidates.data.nextCursor} onClick={() => { setCursors(values => [...values.slice(0, page + 1), candidates.data!.nextCursor!]); setPage(value => value + 1); }}>Próxima</Button></ButtonGroup>} />}
      </>}
      <Field label="Motivo da substituição" required hint="O substituto exige uma nova revisão. Artigos existentes permanecem no histórico.">{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} maxLength={2000} disabled={locked} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
    </Section>}
  </ResponsiveDialog>;
}
export function MemoryReplacementReader({ id, open, onClose, onEvidence }: { id: string; open: boolean; onClose: () => void; onEvidence: (id: string) => void }) {
  const load = useCallback((port: MemoryLibrary) => port.replacement(id), [id]), resource = useMemoryResource(load, 0, open), session = useSession().data;
  const comparison = resource.data, actor = comparison?.relation.personId;
  const name = (actor === session?.current?.id ? session?.current?.name : session?.members.find(member => member.id === actor)?.name) ?? actor;
  return <ResponsiveDialog open={open} size="lg" title="Substituição registrada" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button>{comparison && <Button onClick={() => onEvidence(comparison.current.id)}>Abrir registro substituto</Button>}</>}>
    {resource.error ? <ErrorState title="Não foi possível abrir a substituição" description={resource.error} onRetry={resource.reload} /> : !comparison ? <Spinner label="Carregando substituição" /> : <Section>
      <DescriptionList items={[{ label: 'Responsável', value: name }, { label: 'Data', value: new Date(comparison.relation.at).toLocaleString('pt-BR') }, { label: 'Motivo', value: comparison.relation.reason }]} />
      <Grid columns="1:1" collapseBelow={480}><Observation title="Registro anterior" evidence={comparison.previous} material={comparison.materials.previous} /><Observation title="Registro substituto" evidence={comparison.current} material={comparison.materials.current} /></Grid>
    </Section>}
  </ResponsiveDialog>;
}
