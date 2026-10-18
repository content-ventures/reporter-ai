'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  DataTable,
  Field,
  IconButton,
  Input,
  MetaList,
  Panel,
  Section,
  Segmented,
  Select,
  Switch,
  SwitchRow,
  TagInput,
} from '@content-ventures/design-system/v3';
import type { Column, SegmentOption } from '@content-ventures/design-system/v3';
import { Plus, Trash2 } from '@content-ventures/design-system/v3/icons';
import { fieldProblem, GUIDES } from './integrations-guides';
import { eventLabel, EVENTS } from './integrations-model';
import type { AppDef, AppRecord, ChatRule, EventId } from './integrations-model';

export type ConfigProps = { def: AppDef; record: AppRecord; update: (patch: Partial<AppRecord>) => void };

/**
 * What each kind of app lets the newsroom decide, the same panels in "Configurar" and in the
 * settings of a connected app. Every change is saved as it happens.
 */
export function AppConfig(props: ConfigProps) {
  switch (props.def.kind) {
    case 'chat':
      return <ChatAlerts {...props} />;
    case 'email':
      return <EmailSettings {...props} />;
    case 'images':
      return <ImageSettings {...props} />;
    case 'alerts':
      return <AlertSettings {...props} />;
    case 'agency':
      return <AgencySettings {...props} />;
    case 'automation':
      return <EventChoice {...props} />;
    case 'publisher':
      return <PublisherSettings {...props} />;
    default:
      return null;
  }
}

const countOn = (rules: readonly ChatRule[]) => rules.filter((rule) => rule.on).length;

/** Slack and Teams: which desk event warns which channel. A rule that is on needs a channel. */
function ChatAlerts({ def, record, update }: ConfigProps) {
  const rules = record.rules ?? [];
  const options = (record.channels ?? []).map((channel) => ({ value: channel, label: channel }));
  const change = (event: EventId, patch: Partial<ChatRule>) => update({ rules: rules.map((rule) => (rule.event === event ? { ...rule, ...patch } : rule)) });

  const columns: Column<ChatRule>[] = [
    { key: 'event', header: 'Aviso', render: (rule) => eventLabel(rule.event) },
    {
      key: 'channel',
      header: 'Canal',
      width: 220,
      render: (rule) => (
        <Select
          size="sm"
          label={`Canal de ${eventLabel(rule.event)}`}
          placeholder="Escolher canal"
          value={rule.channel}
          options={options}
          disabled={!rule.on}
          invalid={rule.on && !rule.channel}
          onChange={(channel) => change(rule.event, { channel })}
        />
      ),
    },
    {
      key: 'on',
      header: 'Ligado',
      width: 88,
      align: 'end',
      render: (rule) => <Switch label={eventLabel(rule.event)} hideLabel checked={rule.on} onCheckedChange={(on) => change(rule.event, { on })} />,
    },
  ];

  return (
    <Panel label="Avisos">
      <Section title="Avisos" id="avisos" meta={`${countOn(rules)} de ${rules.length} ligados`}>
        <DataTable label={`Avisos no ${def.name}`} rows={rules} rowKey={(rule) => rule.event} rowLabel={(rule) => eventLabel(rule.event)} columns={columns} />
      </Section>
    </Panel>
  );
}

/** E-mail: who receives, the morning summary, and which events send a message at once. */
function EmailSettings({ record, update }: ConfigProps) {
  const rules = record.rules ?? [];
  return (
    <Panel label="E-mail">
      <Section title="Destinatários" id="destinatarios">
        <Field label="Endereços" hint="Enter adiciona">
          {({ id, describedBy, invalid }) => (
            <TagInput id={id} describedBy={describedBy} invalid={invalid} values={record.recipients ?? []} placeholder="nome@portal.com.br" onChange={(recipients) => update({ recipients })} />
          )}
        </Field>
      </Section>
      <Section title="Avisos" id="avisos" meta={`${countOn(rules)} de ${rules.length} ligados`}>
        <SwitchRow label="Resumo do dia às 8:00" checked={Boolean(record.digest)} onCheckedChange={(digest) => update({ digest })} />
        {rules.map((rule) => (
          <SwitchRow
            key={rule.event}
            label={eventLabel(rule.event)}
            checked={rule.on}
            onCheckedChange={(on) => update({ rules: rules.map((item) => (item.event === rule.event ? { ...item, on } : item)) })}
          />
        ))}
      </Section>
    </Panel>
  );
}

/** Photo banks: the credit line and saving to the archive (the plan's usage is under the lockup). */
function ImageSettings({ def, record, update }: ConfigProps) {
  return (
    <Panel label="Imagens">
      <Section title="Crédito" id="credito">
        <Field label="Formato do crédito" hint={`“Nome” vira o autor da foto: Ana Lima/${def.name}`}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={record.credit ?? ''} placeholder={`Nome/${def.name}`} onChange={(event) => update({ credit: event.target.value })} />
          )}
        </Field>
        <SwitchRow label="Salvar no acervo ao usar" checked={Boolean(record.saveOnUse)} onCheckedChange={(saveOnUse) => update({ saveOnUse })} />
      </Section>
    </Panel>
  );
}

/** Google Alertas: one RSS feed per keyword, added with the link copied from Google Alertas. */
function AlertSettings({ record, update }: ConfigProps) {
  const feeds = record.feeds ?? [];
  const [query, setQuery] = useState('');
  const [url, setUrl] = useState('');
  const [errors, setErrors] = useState<{ query?: string; url?: string }>({});
  const feedField = GUIDES['google-alerts']?.fields.find((field) => field.id === 'feedUrl');

  function add() {
    const problems = {
      query: query.trim() ? undefined : 'Digite a palavra-chave do alerta.',
      url: feedField ? fieldProblem(feedField, url) : undefined,
    };
    setErrors(problems);
    if (problems.query || problems.url) return;
    update({ feeds: [...feeds, { query: query.trim(), url: url.trim() }] });
    setQuery('');
    setUrl('');
  }

  const columns: Column<{ query: string; url: string }>[] = [
    { key: 'query', header: 'Palavra-chave', width: 200, render: (feed) => feed.query },
    { key: 'url', header: 'Feed', render: (feed) => <MetaList size="sm" wrap={false} items={[feed.url]} /> },
    {
      key: 'remove',
      header: '',
      width: 56,
      align: 'end',
      render: (feed) => (
        <IconButton
          label={`Remover alerta ${feed.query}`}
          icon={Trash2}
          variant="ghost"
          size="sm"
          tone="danger"
          onClick={() => update({ feeds: feeds.filter((item) => item.url !== feed.url) })}
        />
      ),
    },
  ];

  return (
    <Panel label="Alertas">
      <Section title="Alertas" id="alertas" meta={feeds.length === 1 ? '1 alerta' : `${feeds.length} alertas`}>
        <DataTable label="Alertas lidos" rows={feeds} rowKey={(feed) => feed.url} rowLabel={(feed) => feed.query} columns={columns} empty="Nenhum alerta ainda." />
      </Section>
      <Section title="Novo alerta" action={<Button variant="secondary" size="sm" icon={Plus} onClick={add}>Adicionar alerta</Button>}>
        <Field label="Palavra-chave" error={errors.query}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={query} placeholder="camarão" onChange={(event) => { setQuery(event.target.value); setErrors((current) => ({ ...current, query: undefined })); }} />
          )}
        </Field>
        <Field label="Link do feed" error={errors.url} hint="Em Google Alertas, o ícone de RSS ao lado do alerta">
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={url} type="url" inputMode="url" placeholder="https://www.google.com/alerts/feeds/…" onChange={(event) => { setUrl(event.target.value); setErrors((current) => ({ ...current, url: undefined })); }} />
          )}
        </Field>
      </Section>
    </Panel>
  );
}

/** A news agency: the sections that reach the radar. */
function AgencySettings({ record, update }: ConfigProps) {
  return (
    <Panel label="Editorias">
      <Section title="Editorias" id="editorias">
        <Field label="Trazer para o radar">
          {({ id, describedBy, invalid }) => (
            <TagInput id={id} describedBy={describedBy} invalid={invalid} values={record.sections ?? []} suggestions={['Agronegócio', 'Economia', 'Comércio exterior', 'Meio ambiente', 'Política']} onChange={(sections) => update({ sections })} />
          )}
        </Field>
      </Section>
    </Panel>
  );
}

/** Zapier and similar: which desk events start an automation. */
function EventChoice({ record, update }: ConfigProps) {
  const chosen = new Set(record.events ?? []);
  const toggle = (event: EventId, on: boolean) => update({ events: EVENTS.map((item) => item.id).filter((id) => (id === event ? on : chosen.has(id))) });
  return (
    <Panel label="Eventos">
      <Section title="Eventos" id="eventos" meta={`${chosen.size} de ${EVENTS.length}`}>
        <CheckboxGroup legend="Enviar quando">
          {EVENTS.map((event) => (
            <Checkbox key={event.id} label={event.label} checked={chosen.has(event.id)} onChange={(changeEvent) => toggle(event.id, changeEvent.target.checked)} />
          ))}
        </CheckboxGroup>
      </Section>
    </Panel>
  );
}

const SEND_OPTIONS: SegmentOption<'draft' | 'published'>[] = [
  { value: 'draft', label: 'Rascunho' },
  { value: 'published', label: 'Publicado', disabled: true, disabledReason: 'A confirmar com o portal' },
];

/** Ghost and Drupal: how an approved article arrives. */
function PublisherSettings({ record }: ConfigProps) {
  return (
    <Panel label="Envio">
      <Section title="Envio" id="envio" action={<Segmented label="Enviar como" size="sm" value="draft" options={SEND_OPTIONS} onChange={() => undefined} />}>
        <Field label="Site">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={record.siteUrl ?? ''} readOnly />}
        </Field>
      </Section>
    </Panel>
  );
}
