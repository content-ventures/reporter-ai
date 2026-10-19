'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Input, toast } from '@content-ventures/design-system/v3';
import { useHardNews } from '../state/hard-news-provider';

/**
 * F2.1 · "Colar link": one address in, the page read as a news item. A story already in the queue
 * opens instead (from another outlet, the outlet joins "Quem publicou"); nothing is duplicated.
 */
export function ImportLinkDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string) => void }) {
  const { actions } = useHardNews();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const [reading, setReading] = useState(false);

  function close() {
    if (reading) return;
    setUrl('');
    setError(undefined);
    onClose();
  }

  async function submit() {
    if (!url.trim() || reading) return;
    setReading(true);
    const result = await actions.importUrl(url);
    setReading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.outcome === 'repeat') toast('Essa notícia já estava na fila');
    else if (result.outcome === 'grouped') toast('Essa notícia já estava na fila', { description: 'O veículo entrou em Quem publicou.' });
    setUrl('');
    setError(undefined);
    onClose();
    onImported(result.id);
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Colar link de notícia"
      divided={false}
      dirty={url.trim().length > 0}
      footer={(
        <>
          <Button variant="secondary" disabled={reading} onClick={close}>Cancelar</Button>
          <Button variant="primary" loading={reading} onClick={() => void submit()} disabled={!url.trim()}>Adicionar à fila</Button>
        </>
      )}
    >
      <Field label="Endereço" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={url}
            type="url"
            inputMode="url"
            placeholder="https://"
            autoFocus
            onChange={(event) => { setUrl(event.target.value); setError(undefined); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
          />
        )}
      </Field>
    </Dialog>
  );
}
