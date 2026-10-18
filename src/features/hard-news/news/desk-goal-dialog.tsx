'use client';

import { useState } from 'react';
import { Button, Dialog, Field, NumberField } from '@content-ventures/design-system/v3';
import { useHardNews } from '../state/hard-news-provider';

/** REQ-2.2 · how many stories the desk wants to open per day. */
export function DeskGoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useHardNews();
  const [value, setValue] = useState<number | null>(state.goal.perDay);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Meta de pautas por dia"
      divided={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!value} onClick={() => { if (value) actions.setGoal(value); onClose(); }}>Salvar meta</Button>
        </>
      )}
    >
      <Field label="Pautas por dia">
        {({ id, describedBy, invalid }) => (
          <NumberField id={id} aria-describedby={describedBy} invalid={invalid} value={value} onChange={setValue} min={1} max={50} stepper fit />
        )}
      </Field>
    </Dialog>
  );
}
