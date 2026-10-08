'use client';

import { useState } from 'react';
import { Button, Field, ResponsiveDialog, Textarea } from '@content-ventures/design-system/v3';
import type { PieceKind } from '@/domain';
import { NOTE_MAX } from '@/ui/approval-copy';
import { approveTitle } from './review-model';

/**
 * "Aprovar o artigo" (COPY §4.4): one optional note for whoever sent it, then "Aprovar". The text
 * stays as the reviewer read it; the dialog says nothing else (the bar already names the piece).
 * The note survives closing the dialog until the piece is approved.
 */
export type ApproveDialogProps = {
  open: boolean;
  onClose: () => void;
  kind: PieceKind;
  /** Resolves with the refusal message, or `null` when the piece was approved. */
  onSubmit: (note: string) => Promise<string | null>;
};

export function ApproveDialog({ open, onClose, kind, onSubmit }: ApproveDialogProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState(open);
  if (session !== open) {
    setSession(open);
    if (open) setError(undefined);
  }

  async function submit() {
    setSending(true);
    const refusal = await onSubmit(note);
    setSending(false);
    if (refusal) setError(refusal);
    else setNote('');
  }

  return (
    <ResponsiveDialog
      open={open}
      onClose={sending ? () => undefined : onClose}
      title={approveTitle(kind)}
      size="sm"
      dirty={note.trim().length > 0}
      footer={
        <>
          <Button onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={sending} onClick={() => void submit()}>
            Aprovar
          </Button>
        </>
      }
    >
      <Field label="Nota (opcional)" error={error}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={note}
            maxLength={NOTE_MAX}
            autoSize={{ minRows: 3, maxRows: 8 }}
            autoFocus
            onChange={(event) => {
              setNote(event.target.value);
              if (error) setError(undefined);
            }}
          />
        )}
      </Field>
    </ResponsiveDialog>
  );
}
