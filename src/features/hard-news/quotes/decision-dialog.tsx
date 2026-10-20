'use client';

import { useState } from 'react';
import { Button, Field, ResponsiveDialog, Section, Select, Textarea } from '@content-ventures/design-system/v3';
import { CLAIM_VERDICT_LABELS } from '@/domain/fact-check';
import type { ClaimVerdict } from '@/domain/fact-check';

const VERDICT_OPTIONS = (['validated', 'disputed', 'not_validated'] as const).map((value) => ({ value, label: CLAIM_VERDICT_LABELS[value] }));

/** The editor's verdict on one claim: a small edit, so a dialog with its own footer. */
export function DecisionDialog({ open, claims, onClose, onSave }: {
  open: boolean;
  claims: { index: number; text: string }[];
  onClose: () => void;
  onSave: (claim: number, verdict: ClaimVerdict, reason: string) => Promise<boolean>;
}) {
  const [claim, setClaim] = useState(claims[0]?.index ?? 0);
  const [verdict, setVerdict] = useState<ClaimVerdict>('validated');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const missing = reason.trim().length < 3;
  return (
    <ResponsiveDialog
      open={open}
      onClose={saving ? () => undefined : onClose}
      title="Corrigir veredito"
      dirty={reason.trim().length > 0}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={async () => {
            setTried(true);
            if (missing) return;
            setSaving(true);
            const saved = await onSave(claim, verdict, reason.trim());
            setSaving(false);
            if (saved) onClose();
          }}>Salvar veredito</Button>
        </>
      )}
    >
      <Section>
        <Field label="Afirmação">
          {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={String(claim)} options={claims.map((entry) => ({ value: String(entry.index), label: entry.text }))}
            onChange={(value) => setClaim(Number(value))} />}
        </Field>
        <Field label="Veredito">
          {({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={verdict} options={VERDICT_OPTIONS} onChange={(value) => setVerdict(value as ClaimVerdict)} />}
        </Field>
        <Field label="Motivo" required error={tried && missing ? 'Diga em que se baseia a decisão.' : undefined}>
          {({ id, describedBy, invalid }) => <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} autoSize maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
      </Section>
    </ResponsiveDialog>
  );
}
