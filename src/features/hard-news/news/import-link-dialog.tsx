'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Input } from '@content-ventures/design-system/v3';
import { useHardNews } from '../state/hard-news-provider';

/** F2.1 · "Colar link": one address in, the news joins the queue and the AI reads it. */
export function ImportLinkDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (id: string) => void }) {
  const { actions } = useHardNews();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();

  function close() {
    setUrl('');
    setError(undefined);
    onClose();
  }

  function submit() {
    const result = actions.importUrl(url);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    close();
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
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={submit} disabled={!url.trim()}>Adicionar à fila</Button>
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
            onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
          />
        )}
      </Field>
    </Dialog>
  );
}
