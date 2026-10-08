'use client';

import { useState } from 'react';
import {
  Button,
  Field,
  IconButton,
  List,
  ListItem,
  ResponsiveDialog,
  Section,
  Textarea,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { X } from '@content-ventures/design-system/v3/icons';
import type { DecisionAnchor } from '@/domain';
import { anchorKey, anchorsLabel, returnDescription, shortExcerpt } from './review-model';

/**
 * "Pedir ajustes" (COPY §4.4): the note is required; the passages the reviewer pointed at in the
 * text travel with it as anchors and become the first turn of the studio assistant. The note
 * survives closing the dialog until it is sent.
 */
export type ReturnDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Whoever sent the piece: "Juliana recebe a nota e os trechos apontados." */
  requesterName?: string | null;
  note: string;
  onNoteChange: (note: string) => void;
  anchors: readonly DecisionAnchor[];
  onRemoveAnchor: (anchor: DecisionAnchor) => void;
  /** Resolves with the refusal message, or `null` when the adjustments were requested. */
  onSubmit: () => Promise<string | null>;
};

const NOTE_LIMIT = 1200;

export function ReturnDialog({ open, onClose, requesterName, note, onNoteChange, anchors, onRemoveAnchor, onSubmit }: ReturnDialogProps) {
  const [error, setError] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState(open);
  if (session !== open) {
    setSession(open);
    if (open) setError(undefined);
  }

  async function submit() {
    if (!note.trim()) {
      setError('Escreva uma nota explicando o que ajustar.');
      return;
    }
    setSending(true);
    const refusal = await onSubmit();
    setSending(false);
    if (refusal) setError(refusal);
  }

  return (
    <ResponsiveDialog
      open={open}
      onClose={sending ? () => undefined : onClose}
      title="Pedir ajustes"
      description={returnDescription(requesterName)}
      size="md"
      dirty={note.trim().length > 0}
      footer={
        <>
          <Button onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={sending} onClick={() => void submit()}>
            Pedir ajustes
          </Button>
        </>
      }
    >
      <Field label="Nota" required error={error}>
        {({ id, describedBy, invalid }) => (
          <Textarea
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={note}
            maxLength={NOTE_LIMIT}
            autoSize={{ minRows: 4, maxRows: 10 }}
            placeholder="O que ajustar antes de aprovar"
            autoFocus
            onChange={(event) => {
              onNoteChange(event.target.value);
              if (error) setError(undefined);
            }}
          />
        )}
      </Field>
      {anchors.length > 0 ? (
        <Section title="Trechos apontados" titleAs="h3" meta={anchorsLabel(anchors.length)}>
          <List label="Trechos apontados">
            {anchors.map((anchor) => (
              <ListItem
                key={anchorKey(anchor)}
                density="sm"
                title={`“${shortExcerpt(anchor.excerpt ?? '', 120)}”`}
                actions={
                  <Tooltip content="Remover trecho">
                    <IconButton
                      icon={X}
                      label={`Remover o trecho “${shortExcerpt(anchor.excerpt ?? '', 40)}”`}
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemoveAnchor(anchor)}
                    />
                  </Tooltip>
                }
              />
            ))}
          </List>
        </Section>
      ) : null}
    </ResponsiveDialog>
  );
}
