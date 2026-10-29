'use client';
import { useCallback, useState } from 'react';
import { Alert, Button, ButtonGroup, DataTable, DescriptionList, EmptyState, ErrorState, Field, FieldGroup, Input, Panel, ResponsiveDialog, Section, Select, Spinner, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryPolicy } from '@/domain/editorial-memory';
import type { MemoryCalibrationCase, MemoryEvaluationCriteria } from '@/domain/editorial-memory-calibration';
import type { MemoryPolicyProposal, MemoryPolicyProposalInput } from '@/domain/editorial-memory-policy';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { useCan } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';
import { CALIBRATION_OUTCOMES, MemoryCalibrationReader } from './memory-calibration-dialog';
import { useMemoryPolicyCommand } from './use-memory-policy-command';

export type MemoryPolicyBasis = { key: string; policy: MemoryPolicy; port: MemoryLibrary };
const CRITERIA = { minTraining: 'Mínimo de amostras de treino por tipo', minValidation: 'Mínimo de amostras de validação por tipo', minOrigins: 'Mínimo de grupos de origem por conjunto e tipo', minReleased: 'Mínimo de liberações na validação por tipo', minPrecision: 'Limite inferior mínimo da precisão (%)', maxErrors: 'Máximo de erros na validação por tipo' };
export function MemoryPolicyProposalDialog({ basis, open, onClose, onSaved }: { basis: MemoryPolicyBasis; open: boolean; onClose: () => void; onSaved: (proposal: MemoryPolicyProposal) => void }) {
  const allowed = useCan('pipeline.edit'), command = useMemoryPolicyCommand(basis.port, open && allowed);
  const [mode, setMode] = useState('review_required'), [fact, setFact] = useState(''), [declared, setDeclared] = useState(''), [reason, setReason] = useState('');
  const [criteria, setCriteria] = useState<Record<keyof MemoryEvaluationCriteria, string>>({ minTraining: '', minValidation: '', minOrigins: '', minReleased: '', minPrecision: '', maxErrors: '' });
  const [cases, setCases] = useState<Record<string, 'training' | 'validation'>>({}), [cursor, setCursor] = useState<string>(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [reading, setReading] = useState<MemoryCalibrationCase>(), [readingOpen, setReadingOpen] = useState(false);
  const load = useCallback((port: MemoryLibrary) => port.calibrationCases({ cursor, limit: 25 }), [cursor]);
  const resource = useMemoryResource(load, 0, open && command.bound && allowed && mode === 'calibrated'), page = resource.data;
  const locked = command.busy || !command.bound || !allowed;
  function input(): MemoryPolicyProposalInput | undefined {
    if (!reason.trim()) return;
    const base = { baseRevision: basis.policy.revision, reason: reason.trim() };
    if (mode === 'review_required') return { ...base, settings: { mode, thresholds: { fact: null, declared: null, opinion: null, forecast: null } }, criteria: null, cases: [] };
    if (![fact, declared].some(value => value.trim()) || [fact, declared].some(value => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100))) return;
    for (const [key, value] of Object.entries(criteria)) if (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < (key === 'maxErrors' || key === 'minPrecision' ? 0 : 1)
      || Number(value) > (key === 'minPrecision' ? 100 : 1000) || key !== 'minPrecision' && !Number.isInteger(Number(value))) return;
    return { ...base, settings: { mode: 'calibrated', thresholds: { fact: fact.trim() ? Number(fact) : null, declared: declared.trim() ? Number(declared) : null, opinion: null, forecast: null } },
      criteria: Object.fromEntries(Object.entries(criteria).map(([key, value]) => [key, Number(value)])) as MemoryEvaluationCriteria,
      cases: Object.entries(cases).map(([id, split]) => ({ id, split })) };
  }
  const payload = input();
  return <><ResponsiveDialog open={open} title="Criar proposta de política" size="lg" dirty={Boolean(reason || fact || declared || Object.keys(cases).length)} onClose={command.busy ? () => undefined : () => { setReadingOpen(false); onClose(); }}
    footer={<><Button variant="ghost" disabled={command.busy} onClick={onClose}>Fechar</Button><Button loading={command.busy} disabled={locked || !payload} onClick={() => { if (payload) void command.execute(payload, key => basis.port.proposePolicy(payload, key), onSaved); }}>Avaliar proposta</Button></>}>
    {!command.bound || !allowed ? <ErrorState title="Acesso alterado" description="Abra uma nova proposta na conta atual." /> : <Panel>
      <Section>
        {command.error && <Alert tone="danger" title={command.error} />}
        <DescriptionList items={[{ label: 'Política de referência', value: `Versão ${basis.policy.revision}` }]} />
        <Field label="Modo da proposta" required>{({ id }) => <Select id={id} value={mode} disabled={locked} onChange={setMode} options={[{ value: 'review_required', label: 'Exigir revisão humana' }, { value: 'calibrated', label: 'Aplicar confiança factual avaliada' }]} />}</Field>
        <Field label="Motivo da proposta" required>{({ id }) => <Textarea id={id} disabled={locked} rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
      </Section>
      {mode === 'calibrated' && <>
        <Section title="Critérios de liberação" titleAs="h3">
          <FieldGroup label="Confiança mínima para liberação" columns={2}>
            <Field label="Confiança mínima para fatos (%)" hint="Em branco mantém a revisão humana.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={locked} type="number" min={0} max={100} value={fact} onChange={event => setFact(event.target.value)} />}</Field>
            <Field label="Confiança mínima para declarações factuais (%)" hint="Em branco mantém a revisão humana.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} disabled={locked} type="number" min={0} max={100} value={declared} onChange={event => setDeclared(event.target.value)} />}</Field>
          </FieldGroup>
          {Object.entries(CRITERIA).map(([key, label]) => <Field key={key} label={label} required>{({ id }) => <Input id={id} disabled={locked} type="number" min={key === 'maxErrors' || key === 'minPrecision' ? 0 : 1} max={key === 'minPrecision' ? 100 : 1000} step={key === 'minPrecision' ? 'any' : 1} value={criteria[key as keyof MemoryEvaluationCriteria]} onChange={event => setCriteria(current => ({ ...current, [key]: event.target.value }))} />}</Field>)}
        </Section>
        <Section title="Amostras avaliadas" titleAs="h3" meta={`${Object.values(cases).filter(value => value === 'training').length} treino · ${Object.values(cases).filter(value => value === 'validation').length} validação`}>
          {resource.error ? <ErrorState title="Não foi possível carregar as amostras" description={resource.error} actions={<Button onClick={() => { setCursor(undefined); setCursors([undefined]); resource.reload(); }}>Atualizar amostras</Button>} /> : !page ? <Spinner label="Carregando amostras factuais" /> : <DataTable label="Amostras para a proposta" rows={page.items} rowKey={item => item.id} columns={[
            { key: 'excerpt', header: 'Trecho original', pinned: true, render: item => <Button variant="ghost" onClick={() => { setReading(item); setReadingOpen(true); }}>{item.excerpt.slice(0, 120)}</Button> },
            { key: 'outcome', header: 'Resultado', render: item => CALIBRATION_OUTCOMES[item.outcome] }, { key: 'purpose', header: 'Finalidade', render: item => item.purpose === 'editorial' ? 'Editorial' : 'Teste técnico' },
            { key: 'split', header: 'Conjunto', render: item => <Select label={`Conjunto da amostra ${item.excerpt.slice(0, 70)}`} disabled={locked} value={cases[item.id] ?? ''} onChange={value => setCases(current => { const next = { ...current }; if (value) next[item.id] = value as 'training' | 'validation'; else delete next[item.id]; return next; })} options={[{ value: '', label: 'Não incluir' }, { value: 'training', label: 'Treino' }, { value: 'validation', label: 'Validação' }]} /> },
          ]} empty={<EmptyState title="Nenhuma amostra factual registrada" description="Abra uma evidência checada e use Avaliar para calibração." />} footer={<ButtonGroup label="Páginas de amostras">
            <Button variant="secondary" disabled={!cursor} onClick={() => setCursor(cursors.indexOf(cursor) > 0 ? cursors[cursors.indexOf(cursor) - 1] : undefined)}>Anterior</Button>
            <Button variant="secondary" disabled={!page.nextCursor} onClick={() => { setCursors(current => [...current.slice(0, current.indexOf(cursor) + 1), page.nextCursor!]); setCursor(page.nextCursor!); }}>Próxima</Button>
          </ButtonGroup>} />}
        </Section>
      </>}
    </Panel>}
  </ResponsiveDialog><MemoryCalibrationReader item={command.bound ? reading : undefined} open={open && readingOpen && command.bound} onClose={() => setReadingOpen(false)} /></>;
}
