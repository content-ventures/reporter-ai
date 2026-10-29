'use client';
import { useCallback, useState } from 'react';
import { Badge, Button, ButtonGroup, DataTable, DescriptionList, EmptyState, ErrorState, Panel, Section, Spinner, toast } from '@content-ventures/design-system/v3';
import type { MemoryPolicy, MemoryPage } from '@/domain/editorial-memory';
import type { MemoryPolicyProposal } from '@/domain/editorial-memory-policy';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, useSession } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { MemoryPolicyProposalDialog, type MemoryPolicyBasis } from './memory-policy-proposal-dialog';
import { MemoryPolicyComparison, POLICY_MODES, type MemoryPolicyReading } from './memory-policy-comparison';

export function MemoryPolicyPanel() {
  const allowed = useCan('pipeline.edit'), load = useCallback((port: MemoryLibrary) => port.policy(), []), resource = useMemoryResource(load, 0, allowed);
  const [creating, setCreating] = useState<MemoryPolicyBasis>(), [creatingOpen, setCreatingOpen] = useState(false), [reading, setReading] = useState<MemoryPolicyReading>(), [readingOpen, setReadingOpen] = useState(false), [epoch, setEpoch] = useState(0);
  const changed = () => { resource.reload(); setEpoch(value => value + 1); toast('Política ativada'); };
  const proposal = (item: MemoryPolicyProposal) => { if (resource.port) { setCreatingOpen(false); setReading({ key: crypto.randomUUID(), kind: 'proposal', id: item.id, port: resource.port }); setReadingOpen(true); setEpoch(value => value + 1); } };
  if (!allowed) return <ErrorState title="A administração da política exige acesso de administrador" />;
  return <>
    <Panel><Section title="Política ativa" action={<Button disabled={!resource.data || !resource.port} onClick={() => { if (resource.port && resource.data) { setCreating(current => current && current.port === resource.port && current.policy.revision === resource.data!.revision ? current : { key: crypto.randomUUID(), policy: resource.data!, port: resource.port! }); setCreatingOpen(true); } }}>Criar proposta</Button>}>
      {resource.error ? <ErrorState title="Não foi possível carregar a política" description={resource.error} onRetry={resource.reload} /> : !resource.data ? <Spinner label="Carregando política ativa" /> : <DescriptionList items={[
        { label: 'Versão', value: resource.data.revision }, { label: 'Modo', value: POLICY_MODES[resource.data.mode] },
        { label: 'Ativada em', value: resource.data.activatedAt ? new Date(resource.data.activatedAt).toLocaleString('pt-BR') : 'Política inicial' },
        { label: 'Motivo', value: resource.data.change?.reason },
      ]} />}
    </Section>
      <Section title="Propostas avaliadas"><PolicyList key={`proposals-${epoch}`} kind="proposals" onProposal={item => { if (resource.port) { setReading({ key: crypto.randomUUID(), port: resource.port, kind: 'proposal', id: item.id }); setReadingOpen(true); } }} /></Section>
      <Section title="Histórico de políticas"><PolicyList key={`versions-${epoch}`} kind="versions" onVersion={version => { if (resource.port) { setReading({ key: crypto.randomUUID(), port: resource.port, kind: 'version', version }); setReadingOpen(true); } }} /></Section>
    </Panel>
    {creating && <MemoryPolicyProposalDialog key={creating.key} basis={creating} open={creatingOpen} onClose={() => setCreatingOpen(false)} onSaved={proposal} />}
    {reading && <MemoryPolicyComparison key={reading.key} basis={reading} current={resource.data} open={readingOpen} onClose={() => setReadingOpen(false)} onChanged={changed} onProposal={proposal} />}
  </>;
}
function PolicyList({ kind, onProposal, onVersion }: { kind: 'proposals' | 'versions'; onProposal?: (item: MemoryPolicyProposal) => void; onVersion?: (item: MemoryPolicy) => void }) {
  const [cursor, setCursor] = useState<string>(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const load = useCallback((port: MemoryLibrary): Promise<MemoryPage<MemoryPolicyProposal | MemoryPolicy>> => kind === 'proposals' ? port.policyProposals({ cursor, limit: 25 }) : port.policyVersions({ cursor, limit: 25 }), [kind, cursor]);
  const resource = useMemoryResource(load), page = resource.data, session = useSession().data;
  const person = (id: string | null) => (id === session?.current?.id ? session?.current?.name : session?.members.find(item => item.id === id)?.name) ?? id ?? 'Política inicial';
  return <>
    {resource.error ? <ErrorState title="Não foi possível carregar o histórico" description={resource.error} actions={<Button onClick={() => { setCursor(undefined); setCursors([undefined]); resource.reload(); }}>Atualizar histórico</Button>} /> : !page ? <Spinner label="Carregando histórico da política" /> : <DataTable label={kind === 'proposals' ? 'Propostas de política' : 'Versões de política'} rows={page.items} rowKey={item => 'evaluation' in item ? item.id : String(item.revision)} rowLabel={item => 'evaluation' in item ? item.reason : `Versão ${item.revision}`} onRowClick={item => { if ('evaluation' in item) onProposal?.(item); else onVersion?.(item); }} columns={[
      { key: 'version', header: 'Referência', render: item => `Versão ${'evaluation' in item ? item.baseRevision : item.revision}` },
      { key: 'mode', header: 'Modo', render: item => POLICY_MODES['evaluation' in item ? item.settings.mode : item.mode] },
      { key: 'reason', header: 'Motivo', pinned: true, render: item => 'evaluation' in item ? item.reason : item.change?.reason ?? 'Política inicial' },
      { key: 'actor', header: 'Responsável', render: item => person('evaluation' in item ? item.createdBy : item.activatedBy) },
      { key: 'date', header: 'Data', render: item => { const value = 'evaluation' in item ? item.createdAt : item.activatedAt; return value ? new Date(value).toLocaleString('pt-BR') : 'Inicial'; } },
      { key: 'state', header: 'Avaliação', render: item => 'evaluation' in item ? <Badge tone={item.evaluation.activatable ? 'green' : 'amber'}>{item.evaluation.activatable ? 'Critérios atendidos' : 'Impedida'}</Badge> : 'Histórica' },
    ]} empty={<EmptyState title="Nenhuma proposta avaliada" />} footer={<ButtonGroup label={`Páginas de ${kind === 'proposals' ? 'propostas' : 'versões'}`}>
      <Button variant="secondary" disabled={!cursor} onClick={() => setCursor(cursors.indexOf(cursor) > 0 ? cursors[cursors.indexOf(cursor) - 1] : undefined)}>Anterior</Button>
      <Button variant="secondary" disabled={!page.nextCursor} onClick={() => { setCursors(current => [...current.slice(0, current.indexOf(cursor) + 1), page.nextCursor!]); setCursor(page.nextCursor!); }}>Próxima</Button>
    </ButtonGroup>} />}
  </>;
}
