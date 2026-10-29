'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, DescriptionList, ErrorState, Field, ResponsiveDialog, Section, Textarea } from '@content-ventures/design-system/v3';
import type { MemoryPolicyReassessmentInput } from '@/domain/editorial-memory-reassessment';
import type { MemoryDetail, MemoryLibrary } from '@/ports/editorial-memory';
import { useCan, useSession } from '@/state';
import { useMemoryPolicyCommand } from './use-memory-policy-command';

export type MemoryReassessmentBasis = { key: string; detail: MemoryDetail; port: MemoryLibrary };
export function MemoryReassessmentDialog({ basis, open, onClose, onSaved }: { basis: MemoryReassessmentBasis; open: boolean; onClose: () => void; onSaved: () => void }) {
  const allowed = useCan('library.edit'), command = useMemoryPolicyCommand(basis.port, open && allowed), session = useSession().data;
  const [detail, setDetail] = useState(basis.detail), [reason, setReason] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null), closeRef = useRef<HTMLButtonElement>(null), focusAfterRefresh = useRef(false);
  const proof = detail.policyReassessment, recorded = !proof && detail.check?.policyEvaluation, locked = command.busy || !command.bound || !allowed;
  const checkedAt = proof?.checkedAt ?? detail.check?.checkedAt;
  useLayoutEffect(() => {
    if (!open || !allowed || !command.bound || command.busy || !focusAfterRefresh.current) return;
    focusAfterRefresh.current = false; (proof ? reasonRef.current : closeRef.current)?.focus();
  }, [detail, open, allowed, command.bound, command.busy, proof]);
  const person = (id: string) => (id === session?.current?.id ? session.current.name : session?.members.find(member => member.id === id)?.name) ?? id;
  function save() {
    if (!proof || !reason.trim()) return;
    const input: MemoryPolicyReassessmentInput = { evidence: proof.evidence, check: proof.check, policyRevision: proof.policyRevision, reason: reason.trim() };
    void command.execute(input, key => basis.port.reassessPolicy(detail.evidence.id, input, key), onSaved);
  }
  return <ResponsiveDialog open={open} title={recorded ? 'Reaplicação registrada' : 'Reaplicar política'} size="lg" dirty={Boolean(reason) && !recorded} onClose={command.busy ? () => undefined : onClose}
    footer={<><Button ref={closeRef} variant="ghost" disabled={command.busy} onClick={onClose}>Fechar</Button>{!recorded && <Button loading={command.busy} disabled={locked || !proof || !reason.trim()} onClick={save}>Reaplicar política</Button>}</>}>
    {!command.bound || !allowed ? <ErrorState title="Acesso alterado" description="Abra a evidência novamente na conta atual." /> : <Section>
      {command.error && <Alert tone="danger" title={command.error} action={<Button disabled={locked} onClick={() => { focusAfterRefresh.current = true; void command.read(() => basis.port.detail(detail.evidence.id), setDetail); }}>Atualizar contexto</Button>} />}
      <Textarea aria-label="Trecho com política reaplicada" readOnly rows={5} value={detail.evidence.anchor.excerpt} />
      <DescriptionList items={[{ label: 'Material', value: detail.material.title }, { label: 'Consulta factual original', value: checkedAt ? new Date(checkedAt).toLocaleString('pt-BR') : 'Não disponível' },
        { label: 'Política da checagem anterior', value: proof?.previousPolicyRevision ?? (recorded ? recorded.previousPolicyRevision : undefined) }, { label: 'Política atual', value: detail.policy.revision }]} />
      {recorded ? <>
        <DescriptionList items={[{ label: 'Reaplicada por', value: person(recorded.personId) }, { label: 'Reaplicada em', value: new Date(recorded.at).toLocaleString('pt-BR') },
          { label: 'Confiança recalculada', value: detail.check?.confidence === null || detail.check?.confidence === undefined ? 'Não calculada' : `${detail.check.confidence}%` }]} />
        <Textarea aria-label="Motivo registrado da reaplicação" readOnly rows={4} value={recorded.reason} />
      </> : !proof ? <ErrorState title="Reaplicação indisponível" description="A evidência exige uma nova checagem ou já usa a política atual." /> :
        <Field label="Motivo da reaplicação" required hint="Mantém o resultado factual, as fontes salvas e a data da consulta. As decisões anteriores continuam desatualizadas.">{({ id, describedBy }) => <Textarea ref={reasonRef} id={id} aria-describedby={describedBy} disabled={locked} maxLength={2000} rows={4} value={reason} onChange={event => setReason(event.target.value)} />}</Field>}
    </Section>}
  </ResponsiveDialog>;
}
