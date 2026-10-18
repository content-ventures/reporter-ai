'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Drawer,
  Field,
  Input,
} from '@content-ventures/design-system/v3';
import { EVENTS, endpointProblem } from './integrations-model';
import type { EventId, WebhookEndpoint } from './integrations-model';

export type EndpointDraft = { name: string; url: string; events: EventId[] };

/**
 * Add or edit an endpoint: a name the desk recognizes, the address that receives the events
 * (https only) and which events it receives. The signing secret is created on save. The parent
 * changes `key` on every opening, so the form starts from the endpoint each time.
 */
export function EndpointDrawer({ open, endpoint, taken, onClose, onSave }: {
  open: boolean;
  /** Editing this one; adding when absent. */
  endpoint?: WebhookEndpoint;
  /** Addresses already in use (another endpoint). */
  taken: string[];
  onClose: () => void;
  onSave: (draft: EndpointDraft) => void;
}) {
  const [name, setName] = useState(endpoint?.name ?? '');
  const [url, setUrl] = useState(endpoint?.url ?? '');
  const [events, setEvents] = useState<EventId[]>(endpoint?.events ?? ['news.priority_high']);
  const [errors, setErrors] = useState<{ name?: string; url?: string; events?: string }>({});

  function save() {
    const problems = {
      name: name.trim() ? undefined : 'Dê um nome que a redação reconheça.',
      url: endpointProblem(url, taken),
      events: events.length ? undefined : 'Escolha ao menos um evento.',
    };
    setErrors(problems);
    if (problems.name || problems.url || problems.events) return;
    onSave({ name: name.trim(), url: url.trim(), events });
  }

  const toggle = (id: EventId, on: boolean) => {
    setEvents(EVENTS.map((event) => event.id).filter((event) => (event === id ? on : events.includes(event))));
    setErrors((current) => ({ ...current, events: undefined }));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={endpoint ? 'Editar endpoint' : 'Novo endpoint'}
      dismissible={false}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save}>{endpoint ? 'Salvar endpoint' : 'Adicionar endpoint'}</Button>
        </>
      )}
    >
      <Field label="Nome" error={errors.name}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={name}
            placeholder="Painel da redação"
            onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }}
          />
        )}
      </Field>
      <Field label="Endereço" error={errors.url} hint="Recebe um POST com JSON a cada evento">
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={url}
            type="url"
            inputMode="url"
            placeholder="https://"
            onChange={(event) => { setUrl(event.target.value); setErrors((current) => ({ ...current, url: undefined })); }}
          />
        )}
      </Field>
      <CheckboxGroup legend="Eventos" error={errors.events}>
        {EVENTS.map((event) => (
          <Checkbox key={event.id} label={event.label} description={event.id} checked={events.includes(event.id)} onChange={(change) => toggle(event.id, change.target.checked)} />
        ))}
      </CheckboxGroup>
    </Drawer>
  );
}
