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
import type { ArticleBody, DecisionAnchor } from '@/domain';
import { anchorKey, sectionMark, shortExcerpt } from './review-model';

/**
 * "Devolver com nota" (PLAN §3.6): the note is required; the passages the reviewer pointed at in
 * the text travel with it as anchors and become the first turn of the studio copilot. The note
 * survives closing the dialog until it is sent.
 */
export type ReturnDialogProps = {
  open: boolean;
  onClose: () => void;
  versionNumber: number;
  note: string;
  onNoteChange: (note: string) => void;
  anchors: readonly DecisionAnchor[];
  onRemoveAnchor: (anchor: DecisionAnchor) => void;
  body?: Pick<ArticleBody, 'blocks'>;
  /** Resolves with the refusal message, or `null` when the version was returned. */
  onSubmit: () => Promise<string | null>;
};

const NOTE_LIMIT = 1200;

export function ReturnDialog({ open, onClose, versionNumber, note, onNoteChange, anchors, onRemoveAnchor, body, onSubmit }: ReturnDialogProps) {
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
      title={`Devolver a versão ${versionNumber}`}
      size="md"
      dirty={note.trim().length > 0}
      footer={
        <>
          <Button onClick={onClose} disabled={sending}>
            Cancelar
          </Button>
          <Button variant="primary" loading={sending} onClick={() => void submit()}>
            Devolver com nota
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
        <Section title="Trechos apontados" titleAs="h3" meta={String(anchors.length)}>
          <List label="Trechos apontados">
            {anchors.map((anchor) => (
              <ListItem
                key={anchorKey(anchor)}
                density="sm"
                title={`“${shortExcerpt(anchor.excerpt ?? '', 120)}”`}
                meta={body ? sectionMark(body, anchor.blockId) : undefined}
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
