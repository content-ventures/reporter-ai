'use client';

import { useState } from 'react';
import {
  AttachedNote,
  Badge,
  BrandMark,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  CopyButton,
  DataTable,
  DescriptionList,
  EmptyState,
  Grid,
  IconButton,
  LinkButton,
  Menu,
  MetaList,
  PageHeader,
  PageStack,
  Panel,
  Section,
  Segmented,
  Timeline,
  toast,
  Tray,
} from '@content-ventures/design-system/v3';
import type { Column, MetricProps, SegmentOption } from '@content-ventures/design-system/v3';
import { AlertTriangle, Ellipsis, Eye, EyeOff, KeyRound, Pause, Pencil, Play, Plus, Send, Trash2, Webhook } from '@content-ventures/design-system/v3/icons';
import { formatAgo } from '@/ui/approval-copy';
import { usePhone } from '@/ui/use-phone';
import { useNow } from '@/ui/time';
import { ConnectionPanel } from './app-parts';
import { EndpointDrawer } from './endpoint-drawer';
import { exampleFields, WEBHOOK_SPEC } from './integrations-guides';
import type { EndpointDraft } from './endpoint-drawer';
import {
  deliveriesOf,
  deliveryLabel,
  deliveryOutcome,
  endpointHost,
  eventLabel,
  failureStreak,
  maskSecret,
  newSecret,
  STATUS_META,
  statusOf,
  successRate,
  webhooksState,
} from './integrations-model';
import type { DeliveryOutcome, WebhookDelivery, WebhookEndpoint } from './integrations-model';
import { useIntegrations } from './integrations-store';

const SEND_MS = 900;
const DAY = 24 * 60 * 60_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const thousands = (value: number) => value.toLocaleString('pt-BR');

const OUTCOME_TONE: Record<DeliveryOutcome, 'green' | 'amber' | 'red'> = { ok: 'green', refused: 'amber', failed: 'red' };

const ENDPOINT_STATE: Record<WebhookEndpoint['state'], { label: string; tone: 'green' | 'red' | 'gray' }> = {
  active: { label: 'Ativo', tone: 'green' },
  failing: { label: 'Com erro', tone: 'red' },
  paused: { label: 'Pausado', tone: 'gray' },
};

type Filter = 'all' | 'failed';
const FILTERS: SegmentOption<Filter>[] = [
  { value: 'all', label: 'Todas' },
  { value: 'failed', label: 'Falhas' },
];

type Pending = { kind: 'remove' | 'secret'; endpoint: WebhookEndpoint };

/**
 * Webhooks: the desk's events (a high-priority story arrived, a production opened, an article was
 * approved, sent to the CMS…) delivered to the newsroom's own systems. Each endpoint is a card
 * with its events, its signing secret and how its deliveries went; one that stopped answering
 * carries the failures and "Reenviar falhas". Under them, every delivery with its HTTP answer.
 */
export function WebhooksScreen() {
  const { state, ready, actions } = useIntegrations();
  const now = useNow();
  const phone = usePhone();
  const [drawer, setDrawer] = useState<{ open: boolean; key: number; endpoint?: WebhookEndpoint }>({ open: false, key: 0 });
  const [pending, setPending] = useState<Pending>();
  const [filter, setFilter] = useState<Filter>('all');
  const endpoints = state.endpoints;
  const status = STATUS_META[statusOf({}, ready ? webhooksState(endpoints) : undefined)];

  const open = (endpoint?: WebhookEndpoint) => setDrawer((current) => ({ open: true, key: current.key + 1, endpoint }));

  function save(draft: EndpointDraft) {
    const editing = drawer.endpoint;
    if (editing) {
      actions.updateEndpoint(editing.id, draft);
      toast('Endpoint salvo', { description: draft.name });
    } else {
      actions.addEndpoint({ ...draft, secret: newSecret() });
      toast('Endpoint adicionado', { description: endpointHost(draft.url) });
    }
    setDrawer((current) => ({ ...current, open: false }));
  }

  async function sendTest(endpoint: WebhookEndpoint) {
    await wait(SEND_MS);
    actions.deliver({ endpointId: endpoint.id, event: endpoint.events[0] ?? 'news.priority_high', status: 200, subject: 'Evento de teste' });
    if (endpoint.state === 'failing') actions.updateEndpoint(endpoint.id, { state: 'active' });
    toast('Teste entregue', { description: `${endpoint.name} respondeu 200` });
  }

  async function resend(endpoint: WebhookEndpoint) {
    const failed = deliveriesOf(state.deliveries, endpoint.id).slice(0, failureStreak(state.deliveries, endpoint.id));
    await wait(SEND_MS);
    for (const delivery of [...failed].reverse()) {
      actions.deliver({ endpointId: endpoint.id, event: delivery.event, status: 200, subject: delivery.subject });
    }
    actions.updateEndpoint(endpoint.id, { state: 'active' });
    toast(failed.length === 1 ? '1 entrega reenviada' : `${failed.length} entregas reenviadas`, { description: endpoint.name });
  }

  const recent = now ? state.deliveries.filter((delivery) => now.getTime() - new Date(delivery.at).getTime() < DAY) : [];
  const delivered = recent.filter((delivery) => deliveryOutcome(delivery.status) === 'ok');
  const rate = recent.length ? Math.round((delivered.length / recent.length) * 100) : undefined;
  const average = delivered.length ? Math.round(delivered.reduce((total, delivery) => total + delivery.ms, 0) / delivered.length) : undefined;
  const metrics: MetricProps[] = [
    { label: 'Entregas em 24 h', value: String(recent.length) },
    { label: 'Entregues', value: rate === undefined ? '—' : String(rate), unit: rate === undefined ? undefined : '%', ...(rate !== undefined && rate < 90 ? { hint: 'Abaixo de 90%', warn: true } : {}) },
    { label: 'Tempo médio', value: average === undefined ? '—' : String(average), unit: average === undefined ? undefined : 'ms' },
  ];

  const failing = endpoints.filter((endpoint) => endpoint.state === 'failing').length;
  const rows = state.deliveries
    .filter((delivery) => filter === 'all' || deliveryOutcome(delivery.status) !== 'ok')
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);
  const nameOf = (id: string) => endpoints.find((endpoint) => endpoint.id === id)?.name ?? 'Endpoint removido';

  const columns: Column<WebhookDelivery>[] = [
    { key: 'event', header: 'Evento', render: (delivery) => eventLabel(delivery.event) },
    { key: 'subject', header: 'Conteúdo', truncate: true, render: (delivery) => delivery.subject },
    { key: 'endpoint', header: 'Endpoint', width: 180, truncate: true, render: (delivery) => nameOf(delivery.endpointId) },
    {
      key: 'status',
      header: 'Resposta',
      width: 132,
      render: (delivery) => <Badge variant="text" size="sm" dot tone={OUTCOME_TONE[deliveryOutcome(delivery.status)]}>{deliveryLabel(delivery.status)}</Badge>,
    },
    { key: 'ms', header: 'Tempo', width: 96, numeric: true, render: (delivery) => (delivery.status === 0 ? '—' : `${thousands(delivery.ms)} ms`) },
    { key: 'when', header: 'Quando', width: 112, render: (delivery) => (now ? formatAgo(delivery.at, now) : undefined), fallback: '—' },
  ];

  return (
    <>
      <PageStack>
        <PageHeader
          title="Webhooks"
          status={ready ? <Badge tone={status.tone} variant="soft" dot={status.hollow ? 'hollow' : true}>{status.label}</Badge> : undefined}
          actions={<Button variant="primary" icon={Plus} onClick={() => open()}>Adicionar endpoint</Button>}
        />
        {!ready ? null : endpoints.length === 0 ? (
          <EmptyState
            icon={Webhook}
            title="Nenhum endpoint"
            actions={<Button variant="primary" icon={Plus} onClick={() => open()}>Adicionar endpoint</Button>}
          />
        ) : (
          <>
            <ConnectionPanel
              name="Webhooks"
              title={endpoints.length === 1 ? '1 endpoint' : `${endpoints.length} endpoints`}
              description="Cada entrega é assinada com o segredo do endpoint"
              metrics={metrics}
            />
            <Tray title="Endpoints" meta={failing ? (failing === 1 ? '1 com erro' : `${failing} com erro`) : undefined}>
              <Grid columns="1:1" collapseBelow={1024} label="Endpoints">
                {endpoints.map((endpoint) => (
                  <EndpointCard
                    key={endpoint.id}
                    endpoint={endpoint}
                    deliveries={state.deliveries}
                    now={now}
                    onTest={() => sendTest(endpoint)}
                    onResend={() => resend(endpoint)}
                    onEdit={() => open(endpoint)}
                    onPause={(paused) => {
                      actions.updateEndpoint(endpoint.id, { state: paused ? 'paused' : 'active' });
                      toast(paused ? `${endpoint.name} pausado` : `${endpoint.name} retomado`);
                    }}
                    onSecret={() => setPending({ kind: 'secret', endpoint })}
                    onRemove={() => setPending({ kind: 'remove', endpoint })}
                  />
                ))}
              </Grid>
            </Tray>
            <Panel label="Entregas">
              <Section
                title="Entregas"
                id="entregas"
                action={<Segmented label="Mostrar" size="sm" value={filter} options={FILTERS} onChange={setFilter} />}
              >
                <DataTable
                  label="Entregas recentes"
                  rows={rows}
                  rowKey={(delivery) => delivery.id}
                  rowLabel={(delivery) => `${eventLabel(delivery.event)}, ${nameOf(delivery.endpointId)}`}
                  columns={columns}
                  hiddenColumns={phone ? ['subject'] : undefined}
                  empty="Nenhuma falha recente."
                />
              </Section>
            </Panel>
            <ReceiverPanel />
          </>
        )}
      </PageStack>
      <EndpointDrawer
        key={drawer.key}
        open={drawer.open}
        endpoint={drawer.endpoint}
        taken={endpoints.filter((endpoint) => endpoint.id !== drawer.endpoint?.id).map((endpoint) => endpoint.url)}
        onClose={() => setDrawer((current) => ({ ...current, open: false }))}
        onSave={save}
      />
      <ConfirmDialog
        open={pending?.kind === 'remove'}
        onClose={() => setPending(undefined)}
        title={`Remover ${pending?.endpoint.name ?? 'endpoint'}?`}
        description="Os eventos param de chegar a esse endereço."
        confirmLabel="Remover endpoint"
        tone="danger"
        onConfirm={() => {
          if (pending) {
            actions.removeEndpoint(pending.endpoint.id);
            toast('Endpoint removido', { description: pending.endpoint.name });
          }
          setPending(undefined);
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'secret'}
        onClose={() => setPending(undefined)}
        title="Gerar novo segredo?"
        description="O segredo atual deixa de valer. Atualize o sistema que recebe os eventos."
        confirmLabel="Gerar novo segredo"
        onConfirm={() => {
          if (pending) {
            actions.updateEndpoint(pending.endpoint.id, { secret: newSecret() });
            toast('Novo segredo gerado', { description: pending.endpoint.name });
          }
          setPending(undefined);
        }}
      />
    </>
  );
}

/** One endpoint: name, address, state; its events, secret and deliveries; test and its menu. */
function EndpointCard({ endpoint, deliveries, now, onTest, onResend, onEdit, onPause, onSecret, onRemove }: {
  endpoint: WebhookEndpoint;
  deliveries: WebhookDelivery[];
  now: Date | undefined;
  onTest: () => Promise<void>;
  onResend: () => Promise<void>;
  onEdit: () => void;
  onPause: (paused: boolean) => void;
  onSecret: () => void;
  onRemove: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [resending, setResending] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const phone = usePhone();
  const state = ENDPOINT_STATE[endpoint.state];
  const own = deliveriesOf(deliveries, endpoint.id);
  const last = own[0];
  const rate = successRate(deliveries, endpoint.id);
  const streak = failureStreak(deliveries, endpoint.id);
  const paused = endpoint.state === 'paused';

  async function run(action: () => Promise<void>, busy: (value: boolean) => void) {
    busy(true);
    await action();
    busy(false);
  }

  const card = (
    <Card padding="md">
      <PageStack>
        <CardHeader
          titleAs="h3"
          leading={<BrandMark name={endpointHost(endpoint.url)} size="lg" />}
          title={endpoint.name}
          badge={<Badge variant="text" size="sm" tone={state.tone} dot={paused ? 'hollow' : true}>{state.label}</Badge>}
          actions={(
            <>
              {phone ? (
                <IconButton label="Enviar teste" icon={Send} variant="secondary" size="sm" loading={sending} disabled={paused} onClick={() => void run(onTest, setSending)} />
              ) : (
                <Button variant="secondary" size="sm" icon={Send} loading={sending} disabled={paused} onClick={() => void run(onTest, setSending)}>Enviar teste</Button>
              )}
              <Menu
                label={`Ações de ${endpoint.name}`}
                align="end"
                sections={[
                  {
                    items: [
                      { label: 'Editar', icon: Pencil, onSelect: onEdit },
                      paused ? { label: 'Retomar', icon: Play, onSelect: () => onPause(false) } : { label: 'Pausar', icon: Pause, onSelect: () => onPause(true) },
                      { label: 'Gerar novo segredo', icon: KeyRound, onSelect: onSecret },
                    ],
                  },
                  { items: [{ label: 'Remover', icon: Trash2, danger: true, onSelect: onRemove }] },
                ]}
                trigger={(props) => <IconButton {...props} label={`Ações de ${endpoint.name}`} icon={Ellipsis} variant="ghost" size="sm" />}
              />
            </>
          )}
        />
        <DescriptionList
          label={`Detalhes de ${endpoint.name}`}
          labelWidth={120}
          items={[
            { label: 'Endereço', value: <MetaList size="md" wrap={false} items={[endpoint.url]} />, copy: endpoint.url },
            { label: 'Eventos', value: endpoint.events.map(eventLabel).join(', ') },
            {
              label: 'Segredo',
              value: (
                <>
                  {revealed ? endpoint.secret : maskSecret(endpoint.secret)}{' '}
                  <IconButton label={revealed ? 'Esconder segredo' : 'Mostrar segredo'} icon={revealed ? EyeOff : Eye} variant="ghost" size="sm" onClick={() => setRevealed(!revealed)} />
                </>
              ),
              copy: endpoint.secret,
              numeric: true,
            },
            rate === undefined
              ? { label: 'Entregues', state: 'empty' }
              : { label: 'Entregues', value: `${Math.round(rate * 100)}% das últimas ${Math.min(own.length, 20)}`, numeric: true },
            last
              ? { label: 'Última', value: `${deliveryLabel(last.status)} · ${now ? formatAgo(last.at, now) : ''}`, numeric: true }
              : { label: 'Última', state: 'empty' },
          ]}
        />
      </PageStack>
    </Card>
  );

  if (endpoint.state !== 'failing') return card;
  return (
    <AttachedNote
      tone="red"
      icon={AlertTriangle}
      note={(
        <>
          {streak > 1 ? `Falhou nas últimas ${streak} entregas` : 'Falhou na última entrega'}{last ? ` · ${deliveryLabel(last.status)}` : ''}{' '}
          <LinkButton size="sm" tone="inherit" disabled={resending} onClick={() => void run(onResend, setResending)}>
            {resending ? 'Reenviando…' : 'Reenviar falhas'}
          </LinkButton>
        </>
      )}
    >
      {card}
    </AttachedNote>
  );
}

const EXAMPLE_FIELDS = exampleFields(WEBHOOK_SPEC.example);
const EXAMPLE_JSON = JSON.stringify(WEBHOOK_SPEC.example, null, 2);

/**
 * What the newsroom's system receives and how it checks the Reporter IA sent it: the request and
 * its headers, the signature check, and the body (with the whole example to copy).
 */
function ReceiverPanel() {
  const columns: Column<{ field: string; example: string }>[] = [
    { key: 'field', header: 'Campo', width: 200, render: (row) => row.field },
    { key: 'example', header: 'Exemplo', render: (row) => row.example },
  ];
  return (
    <Panel label="Como seu sistema recebe">
      <Section title="Como seu sistema recebe" id="recebimento">
        <DescriptionList label="Cada entrega" items={WEBHOOK_SPEC.request.map((item) => ({ label: item.label, value: item.value }))} />
      </Section>
      <Section title="Conferir a assinatura">
        <Timeline
          variant="steps"
          label="Conferir a assinatura"
          items={WEBHOOK_SPEC.signature.map((step, index) => ({ id: `sig-${index}`, title: step.title, description: 'detail' in step ? step.detail : undefined, state: 'upcoming' as const }))}
        />
      </Section>
      <Section title="Corpo" meta={eventLabel(WEBHOOK_SPEC.example.event)} action={<CopyButton text={EXAMPLE_JSON} label="exemplo do corpo em JSON" />}>
        <DataTable label="Campos do corpo" rows={EXAMPLE_FIELDS} rowKey={(row) => row.field} rowLabel={(row) => row.field} columns={columns} />
      </Section>
    </Panel>
  );
}
