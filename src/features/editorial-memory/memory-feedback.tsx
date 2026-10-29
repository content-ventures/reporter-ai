'use client';
import { useCallback, useState } from 'react';
import { Button, ButtonGroup, DataTable, DescriptionList, EmptyState, ErrorState, ResponsiveDialog, Section, Select, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryFeedback, MemoryFeedbackKind, MemoryFeedbackQuery } from '@/domain/editorial-memory-feedback';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useSession } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { MemoryDiscoveryDetails } from './memory-discovery';

const KIND_LABELS: Record<MemoryFeedbackKind, string> = { correction: 'Correção', rejection: 'Rejeição ou pedido de revisão', conflict_resolution: 'Conflito resolvido', relevance: 'Relevância para a pauta' };
export function MemoryFeedbackPanel({ query, onQuery, onTarget }: { query: MemoryFeedbackQuery; onQuery: (query: MemoryFeedbackQuery) => void; onTarget: (target: MemoryFeedback['target']) => void }) {
  const load = useCallback((port: MemoryLibrary) => port.feedback(query), [query]), resource = useMemoryResource(load), session = useSession().data;
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [reading, setReading] = useState<{ item: MemoryFeedback; port: MemoryLibrary }>(), [readingOpen, setReadingOpen] = useState(false);
  const person = (id: string) => (id === session?.current?.id ? session?.current?.name : session?.members.find(member => member.id === id)?.name) ?? id;
  const selected = reading?.port === resource.port ? reading?.item : undefined, page = resource.data, cursor = query.cursor;
  return <>
    <Section action={<Select label="Tipo de feedback" value={query.kind ?? ''} options={[{ value: '', label: 'Todos os tipos' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))]}
      onChange={value => { setCursors([undefined]); onQuery({ ...query, kind: value as MemoryFeedbackKind || undefined, cursor: undefined }); }} />}>
      {query.evidenceId || query.materialId ? <Button variant="ghost" onClick={() => { setCursors([undefined]); onQuery({ kind: query.kind }); }}>Limpar evidência ou material</Button> : undefined}
      {resource.error ? <ErrorState title="Não foi possível carregar o feedback" description={resource.error} actions={<Button onClick={() => { setCursors([undefined]); onQuery({ ...query, cursor: undefined }); resource.reload(); }}>Atualizar feedback</Button>} /> : !page ? <Spinner label="Carregando feedback editorial" /> : <DataTable label="Feedback editorial" rows={page.items} rowKey={item => item.id} rowLabel={item => item.reason.slice(0, 100)}
        onRowClick={item => { if (resource.port) { setReading({ item, port: resource.port }); setReadingOpen(true); } }}
        columns={[{ key: 'kind', header: 'Tipo', render: item => KIND_LABELS[item.kind] }, { key: 'reason', header: 'Motivo', pinned: true, render: item => item.reason.slice(0, 180) },
          { key: 'actor', header: 'Responsável', render: item => person(item.personId) }, { key: 'date', header: 'Data', render: item => new Date(item.at).toLocaleString('pt-BR') }]}
        empty={<EmptyState title="Nenhum feedback registrado" />}
        footer={<ButtonGroup label="Páginas de feedback"><Button variant="secondary" disabled={!cursor} onClick={() => onQuery({ ...query, cursor: cursors.indexOf(cursor) > 0 ? cursors[cursors.indexOf(cursor) - 1] : undefined })}>{cursors.indexOf(cursor) < 0 ? 'Primeira página' : 'Anterior'}</Button>
          <Button variant="secondary" disabled={!page.nextCursor} onClick={() => { setCursors(values => { const index = values.indexOf(cursor); return [...(index < 0 ? [undefined, cursor] : values.slice(0, index + 1)), page.nextCursor!]; }); onQuery({ ...query, cursor: page.nextCursor! }); }}>Próxima</Button></ButtonGroup>} />}
    </Section>
    <ResponsiveDialog open={readingOpen} title="Feedback registrado" size="lg" onClose={() => setReadingOpen(false)} footer={<><Button variant="ghost" onClick={() => setReadingOpen(false)}>Fechar</Button>{selected && <Button onClick={() => { setReadingOpen(false); onTarget(selected.target); }}>{selected.target.kind === 'material' ? 'Ver material' : 'Ver evidência'}</Button>}</>}>
      {!selected ? <ErrorState title="A conta mudou" description="Abra o feedback novamente na conta atual." /> : <Section>
        <DescriptionList items={[{ label: 'Tipo', value: KIND_LABELS[selected.kind] }, { label: 'Responsável', value: person(selected.personId) }, { label: 'Data', value: new Date(selected.at).toLocaleString('pt-BR') },
          ...(selected.source ? [{ label: 'Versão do original', value: selected.source.sourceVersion }] : []), ...(selected.before ? [{ label: 'Revisão anterior', value: selected.before.revision }] : []),
          ...(selected.after ? [{ label: 'Revisão registrada', value: selected.after.revision }] : []),
          ...(selected.rating ? [{ label: 'Utilidade para a pauta', value: selected.rating === 'useful' ? 'Útil para a pauta' : 'Não foi útil para a pauta' }] : [])]} />
        <Textarea aria-label="Motivo do feedback" readOnly rows={5} value={selected.reason} />
        {selected.query && selected.after && <MemoryDiscoveryDetails discovery={{ query: selected.query, evidence: selected.after }} />}
      </Section>}
    </ResponsiveDialog>
  </>;
}
