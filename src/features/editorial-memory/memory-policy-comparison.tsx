'use client';
import { useCallback, useState } from 'react';
import { Alert, Badge, Button, DataTable, DescriptionList, ErrorState, Field, Panel, ResponsiveDialog, Section, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryPolicy } from '@/domain/editorial-memory';
import type { MemoryPolicyProposal } from '@/domain/editorial-memory-policy';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { useMemoryPolicyCommand } from './use-memory-policy-command';

export const POLICY_MODES = { review_required: 'Revisão humana obrigatória', calibrated: 'Confiança factual avaliada' };
const KINDS = { fact: 'Fato', declared: 'Declaração factual', opinion: 'Opinião', forecast: 'Previsão' } as const;
const BLOCKERS: Record<string, string> = { EDITORIAL_CORPUS_REQUIRED: 'A proposta exige amostras editoriais reais.', SOURCE_LEAKAGE: 'Os conjuntos compartilham origens, trechos ou fontes da checagem.',
  INSUFFICIENT_ORIGINS: 'Faltam grupos de origem independentes.', THRESHOLD_REQUIRED: 'Defina um limite para fatos ou declarações factuais.',
  INSUFFICIENT_FACT_CASES: 'Faltam amostras de fatos.', INSUFFICIENT_DECLARED_CASES: 'Faltam amostras de declarações factuais.',
  INSUFFICIENT_FACT_ORIGINS: 'Faltam grupos independentes de fatos.', INSUFFICIENT_DECLARED_ORIGINS: 'Faltam grupos independentes de declarações factuais.',
  QUALITY_FACT_NOT_MET: 'Os fatos não atendem aos critérios de qualidade.', QUALITY_DECLARED_NOT_MET: 'As declarações factuais não atendem aos critérios de qualidade.' };
const percentage = (value: number | null) => value === null ? 'Não medida' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export type MemoryPolicyReading = { key: string; port: MemoryLibrary } & ({ kind: 'proposal'; id: string } | { kind: 'version'; version: MemoryPolicy });
export function MemoryPolicyComparison({ basis, current, open, onClose, onChanged, onProposal }: { basis: MemoryPolicyReading; current?: MemoryPolicy; open: boolean; onClose: () => void; onChanged: () => void; onProposal: (proposal: MemoryPolicyProposal) => void }) {
  const allowed = useCan('pipeline.edit'), command = useMemoryPolicyCommand(basis.port, open && allowed), [reason, setReason] = useState('');
  const load = useCallback((port: MemoryLibrary) => basis.kind === 'proposal' ? port.policyProposal(basis.id) : Promise.resolve(undefined), [basis]);
  const resource = useMemoryResource(load, 0, open && command.bound && allowed && basis.kind === 'proposal'), proposal = resource.data;
  const outdated = proposal && current?.revision !== proposal.baseRevision, locked = command.busy || !command.bound || !allowed || !current || !reason.trim();
  function save() {
    if (!current || locked) return;
    const input = { baseRevision: current.revision, reason: reason.trim() };
    if (basis.kind === 'version') {
      const payload = { ...input, targetRevision: basis.version.revision };
      void command.execute(payload, key => basis.port.restorePolicy(payload, key), onProposal);
    } else if (proposal && !outdated && proposal.evaluation.activatable) {
      void command.execute({ id: proposal.id, ...input }, key => basis.port.activatePolicy(proposal.id, input, key), () => { onChanged(); onClose(); });
    }
  }
  return <ResponsiveDialog open={open} title={basis.kind === 'version' ? `Política versão ${basis.version.revision}` : 'Comparar proposta de política'} size="lg" dirty={Boolean(reason)} onClose={command.busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={command.busy} onClick={onClose}>Fechar</Button><Button loading={command.busy} disabled={locked || basis.kind === 'proposal' && (!proposal?.evaluation.activatable || Boolean(outdated) || Boolean(resource.error))} onClick={save}>{basis.kind === 'version' ? 'Preparar restauração' : 'Ativar proposta'}</Button></>}>
    {!command.bound || !allowed ? <ErrorState title="Acesso alterado" description="Abra a política novamente na conta atual." /> : <Panel>
      {command.error && <Section><Alert tone="danger" title={command.error} /></Section>}
      {basis.kind === 'version' ? <Section>
        <DescriptionList items={[{ label: 'Modo', value: POLICY_MODES[basis.version.mode] }, { label: 'Responsável', value: basis.version.activatedBy ?? 'Política inicial' },
          { label: 'Ativada em', value: basis.version.activatedAt ? new Date(basis.version.activatedAt).toLocaleString('pt-BR') : 'Padrão inicial' }, { label: 'Motivo', value: basis.version.change?.reason },
          { label: 'Confiança mínima para fatos', value: basis.version.thresholds.fact === null ? 'Revisão humana' : percentage(basis.version.thresholds.fact) },
          { label: 'Confiança mínima para declarações', value: basis.version.thresholds.declared === null ? 'Revisão humana' : percentage(basis.version.thresholds.declared) }]} />
      </Section> : resource.error ? <Section><ErrorState title="Não foi possível abrir a proposta" description={resource.error} onRetry={resource.reload} /></Section> : !proposal ? <Section><Spinner label="Carregando avaliação da proposta" /></Section> : <>
        <Section title="Alterações propostas" titleAs="h3" meta={<Badge tone={proposal.evaluation.activatable ? 'green' : 'amber'}>{proposal.evaluation.activatable ? 'Critérios atendidos' : 'Ativação impedida'}</Badge>}>
          {outdated && <Alert tone="warning" title="A política ativa mudou">Crie uma nova proposta usando a versão atual.</Alert>}
          <DescriptionList items={[{ label: 'Referência', value: `Versão ${proposal.baseRevision} · ${POLICY_MODES[proposal.baseline.mode]}` }, { label: 'Proposta', value: POLICY_MODES[proposal.settings.mode] },
            { label: 'Proposta por', value: proposal.createdBy }, { label: 'Criada em', value: new Date(proposal.createdAt).toLocaleString('pt-BR') },
            ...(proposal.restoredFrom ? [{ label: 'Restaurar configuração', value: `Versão ${proposal.restoredFrom}` }] : [])]} />
          <Textarea aria-label="Motivo registrado da proposta" readOnly rows={3} value={proposal.reason} />
          <DataTable label="Comparação dos limites" rows={Object.keys(KINDS) as (keyof typeof KINDS)[]} rowKey={kind => kind} columns={[
            { key: 'kind', header: 'Tipo', render: kind => KINDS[kind] }, { key: 'before', header: 'Política de referência', render: kind => proposal.baseline.thresholds[kind] === null ? 'Revisão humana' : percentage(proposal.baseline.thresholds[kind]) },
            { key: 'after', header: 'Proposta', render: kind => proposal.settings.thresholds[kind] === null ? 'Revisão humana' : percentage(proposal.settings.thresholds[kind]) },
          ]} />
        </Section>
        {proposal.settings.mode === 'calibrated' && <Section title="Avaliação reservada" titleAs="h3">
          <DescriptionList items={[{ label: 'Treino', value: `${proposal.evaluation.training} amostras · ${proposal.evaluation.trainingOrigins} grupos de origem` },
            { label: 'Validação', value: `${proposal.evaluation.validation} amostras · ${proposal.evaluation.validationOrigins} grupos de origem` },
            { label: 'Finalidade do conjunto', value: proposal.evaluation.purpose === 'editorial' ? 'Avaliação editorial' : 'Teste técnico' },
            { label: 'Identificação do conjunto', value: proposal.evaluation.datasetHash }]} />
          <DataTable label="Comparação dos resultados medidos" rows={proposal.evaluation.metrics} rowKey={item => item.kind} columns={[
            { key: 'kind', header: 'Tipo', render: item => KINDS[item.kind] }, { key: 'baseline', header: 'Liberações da referência', render: item => item.baselineReleased ?? 'Não comparável' },
            { key: 'released', header: 'Liberações da proposta', render: item => item.released }, { key: 'errors', header: 'Erros', render: item => item.errors },
            { key: 'groups', header: 'Grupos liberados', render: item => item.releasedOrigins }, { key: 'precision', header: 'Precisão observada', render: item => percentage(item.precision) },
            { key: 'lower', header: 'Limite inferior (95%)', render: item => percentage(item.lowerBound) },
          ]} />
          <DescriptionList items={proposal.evaluation.calibration.bins.map(bin => ({ label: bin.key === 'one_origin' ? 'Uma origem independente' : 'Múltiplas origens independentes', value: `${bin.confirmed}/${bin.total} grupos confirmados · confiança ${bin.confidence}%` }))} />
          {proposal.evaluation.criteria && <DescriptionList items={[{ label: 'Critério de precisão mínima', value: percentage(proposal.evaluation.criteria.minPrecision) }, { label: 'Erros máximos', value: proposal.evaluation.criteria.maxErrors },
            { label: 'Mínimos de treino / validação', value: `${proposal.evaluation.criteria.minTraining} / ${proposal.evaluation.criteria.minValidation}` }, { label: 'Grupos mínimos por conjunto e tipo', value: proposal.evaluation.criteria.minOrigins }, { label: 'Liberações mínimas por tipo', value: proposal.evaluation.criteria.minReleased }]} />}
        </Section>}
        {proposal.evaluation.blockers.length > 0 && <Section title="Impedimentos" titleAs="h3"><DescriptionList items={proposal.evaluation.blockers.map((code, index) => ({ label: `${index + 1}`, value: BLOCKERS[code] ?? code }))} /></Section>}
      </>}
      <Section><Field label={basis.kind === 'version' ? 'Motivo da restauração' : 'Motivo da ativação'} required hint={basis.kind === 'version' ? 'Cria outra proposta para avaliação e ativação; preserva os dados novos.' : 'Checagens e decisões anteriores ficam desatualizadas. Artigos e versões já produzidos são preservados.'}>{({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} disabled={command.busy} maxLength={2000} rows={3} value={reason} onChange={event => setReason(event.target.value)} />}</Field></Section>
    </Panel>}
  </ResponsiveDialog>;
}
