'use client';
import { useState } from 'react';
import { Alert, Button, DescriptionList, ErrorState, Field, ResponsiveDialog, Section, Select, Textarea } from '@content-ventures/design-system/v3';
import { memoryEvidenceRef } from '@/domain/editorial-memory';
import type { MemoryCalibrationCase, MemoryCalibrationCaseInput } from '@/domain/editorial-memory-calibration';
import type { MemoryDetail, MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, useSession } from '@/state';
import { useMemoryPolicyCommand } from './use-memory-policy-command';

export const CALIBRATION_OUTCOMES = { confirmed: 'Confirmada', contradicted: 'Contradita', insufficient: 'Evidência insuficiente' };
export type MemoryCalibrationBasis = { key: string; detail: MemoryDetail; port: MemoryLibrary };
export function MemoryCalibrationDialog({ basis, open, onClose, onSaved }: { basis: MemoryCalibrationBasis; open: boolean; onClose: () => void; onSaved: () => void }) {
  const allowed = useCan('library.review'), command = useMemoryPolicyCommand(basis.port, open && allowed);
  const [purpose, setPurpose] = useState(''), [outcome, setOutcome] = useState(''), [reason, setReason] = useState('');
  const { evidence, check, material, policy } = basis.detail, locked = command.busy || !command.bound || !allowed;
  function save() {
    if (!check || !purpose || !outcome || !reason.trim()) return;
    const input: MemoryCalibrationCaseInput = { evidence: memoryEvidenceRef(evidence), check: { id: check.id, revision: check.revision },
      purpose: purpose as MemoryCalibrationCaseInput['purpose'], outcome: outcome as MemoryCalibrationCaseInput['outcome'], reason: reason.trim() };
    void command.execute(input, key => basis.port.annotateCalibration(input, key), onSaved);
  }
  return <ResponsiveDialog open={open} title="Avaliar para calibração" size="lg" dirty={Boolean(purpose || outcome || reason)} onClose={command.busy ? () => undefined : onClose}
    footer={<><Button variant="ghost" disabled={command.busy} onClick={onClose}>Fechar</Button><Button loading={command.busy} disabled={locked || !check || !purpose || !outcome || !reason.trim()} onClick={save}>Registrar amostra</Button></>}>
    {!command.bound || !allowed ? <ErrorState title="Acesso alterado" description="Abra a evidência novamente na conta atual." /> : <Section>
      {command.error && <Alert tone="danger" title={command.error} />}
      <Textarea aria-label="Trecho da amostra factual" readOnly rows={5} value={evidence.anchor.excerpt} />
      <DescriptionList items={[{ label: 'Material', value: material.title }, { label: 'Versão do original', value: evidence.anchor.source.sourceVersion },
        { label: 'Revisão da evidência', value: evidence.revision }, { label: 'Revisão da checagem', value: check?.revision }, { label: 'Política', value: policy.revision }]} />
      <Field label="Finalidade da amostra" required>{({ id }) => <Select id={id} disabled={locked} value={purpose} onChange={setPurpose} options={[{ value: '', label: 'Escolha a finalidade' }, { value: 'technical', label: 'Teste técnico com conteúdo sintético' }, { value: 'editorial', label: 'Avaliação editorial de conteúdo real' }]} />}</Field>
      <Field label="Resultado factual conferido" required hint="Confira o original e as fontes da checagem. Esta amostra não altera a decisão de uso da evidência.">{({ id, describedBy }) => <Select id={id} aria-describedby={describedBy} disabled={locked} value={outcome} onChange={setOutcome} options={[{ value: '', label: 'Escolha o resultado' }, ...Object.entries(CALIBRATION_OUTCOMES).map(([value, label]) => ({ value, label }))]} />}</Field>
      <Field label="Justificativa da amostra" required>{({ id }) => <Textarea id={id} disabled={locked} maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
    </Section>}
  </ResponsiveDialog>;
}
export function MemoryCalibrationReader({ item, open, onClose }: { item?: MemoryCalibrationCase; open: boolean; onClose: () => void }) {
  const session = useSession().data, person = item && ((item.personId === session?.current?.id ? session.current.name : session?.members.find(member => member.id === item.personId)?.name) ?? item.personId);
  return <ResponsiveDialog open={open} title="Amostra factual" size="lg" onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
    {item && <Section><Textarea aria-label="Trecho original da amostra" readOnly rows={6} value={item.excerpt} />
      <DescriptionList items={[{ label: 'Material', value: item.materialTitle }, { label: 'Resultado', value: CALIBRATION_OUTCOMES[item.outcome] }, { label: 'Finalidade', value: item.purpose === 'editorial' ? 'Avaliação editorial' : 'Teste técnico' },
        { label: 'Versão do original', value: item.source.sourceVersion }, { label: 'Revisão da evidência', value: item.evidence.revision }, { label: 'Revisão da checagem', value: item.check.revision }, { label: 'Política avaliada', value: item.policyRevision },
        { label: 'Responsável', value: person }, { label: 'Data', value: new Date(item.at).toLocaleString('pt-BR') }]} />
      <Textarea aria-label="Justificativa registrada" readOnly rows={4} value={item.reason} />
    </Section>}
  </ResponsiveDialog>;
}
