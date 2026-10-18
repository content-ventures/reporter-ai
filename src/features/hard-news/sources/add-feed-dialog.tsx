'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Input, Section, Select, toast } from '@content-ventures/design-system/v3';
import { useHardNews } from '../state/hard-news-provider';
import { DEFAULT_INTERVAL, INTERVAL_OPTIONS, isWebAddress } from './feed-format';

type FieldError = { field: 'name' | 'url'; message: string };

/** F2.1 · "Adicionar fonte": a name, the RSS address and how often to read it. */
export function AddFeedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { actions } = useHardNews();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [every, setEvery] = useState(String(DEFAULT_INTERVAL));
  const [error, setError] = useState<FieldError>();
  const ready = name.trim().length > 0 && url.trim().length > 0;

  function close() {
    setName('');
    setUrl('');
    setEvery(String(DEFAULT_INTERVAL));
    setError(undefined);
    onClose();
  }

  function submit() {
    if (!ready) return;
    const result = actions.addFeed({ name, url, everyMinutes: Number(every) });
    if (!result.ok) {
      // The desk checks the address first, then the name, then duplicates.
      setError({ field: !name.trim() && isWebAddress(url) ? 'name' : 'url', message: result.message });
      return;
    }
    toast('Fonte adicionada', { description: name.trim() });
    close();
  }

  const onEnter = (event: { key: string }) => { if (event.key === 'Enter') submit(); };

  return (
    <Dialog
      open={open}
      onClose={close}
      size="sm"
      title="Adicionar fonte"
      divided={false}
      dirty={name.trim().length > 0 || url.trim().length > 0}
      footer={(
        <>
          <Button variant="secondary" onClick={close}>Cancelar</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>Adicionar fonte</Button>
        </>
      )}
    >
      {/* A headless Section gives the fields the form rhythm (20 px between them). */}
      <Section>
        <Field label="Nome" error={error?.field === 'name' ? error.message : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              placeholder="Ex.: Agência Litoral"
              autoFocus
              onChange={(event) => { setName(event.target.value); setError(undefined); }}
              onKeyDown={onEnter}
            />
          )}
        </Field>
        <Field label="Endereço do feed RSS" error={error?.field === 'url' ? error.message : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={url}
              type="url"
              inputMode="url"
              placeholder="https://"
              onChange={(event) => { setUrl(event.target.value); setError(undefined); }}
              onKeyDown={onEnter}
            />
          )}
        </Field>
        <Field label="Frequência">
          {({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={every} options={INTERVAL_OPTIONS} onChange={setEvery} />
          )}
        </Field>
      </Section>
    </Dialog>
  );
}
