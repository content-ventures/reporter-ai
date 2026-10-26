'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  CardHeader,
  ConfirmDialog,
  DataTable,
  IconButton,
  Menu,
  PageHeader,
  PageStack,
  Panel,
  Prose,
  Section,
  Segmented,
  Select,
  SwitchRow,
  TextLink,
  toast,
} from '@content-ventures/design-system/v3';
import type { Column, SegmentOption } from '@content-ventures/design-system/v3';
import { Ellipsis, RefreshCw, Unlink } from '@content-ventures/design-system/v3/icons';
import { CMS_MODE_LABELS } from '@/domain/hard-news';
import type { CmsConnection, CmsDelivery, CmsMode, EditorialTopic } from '@/domain/hard-news';
import { useCan, useSession } from '@/state';
import { formatAgo } from '@/ui/approval-copy';
import { useBreadcrumb } from '@/ui/shell';
import { useNow } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { deliveryHref } from '../routes';
import { useHardNews } from '../state/hard-news-provider';
import { ConnectionPanel, HealthTray, HowItWorksPanel } from './app-parts';
import { SetupPage } from './app-setup';
import { guideOf } from './integrations-guides';
import { AdminOnly } from './integrations-screen';
import { appDef, cmsChecks, testPlan } from './integrations-model';
import type { AppDef, AppRecord } from './integrations-model';
import { useIntegrations } from './integrations-store';
import { CMS_STATUS, portalHost } from './portal-address';
import { INTEGRATIONS_HREF } from './use-catalog';

const PENDING = 'A confirmar com o portal';

const MODE_OPTIONS: SegmentOption<CmsMode>[] = [
  { value: 'draft', label: CMS_MODE_LABELS.draft },
  { value: 'scheduled', label: CMS_MODE_LABELS.scheduled, disabled: true, disabledReason: PENDING },
  { value: 'published', label: CMS_MODE_LABELS.published, disabled: true, disabledReason: PENDING },
];

const MODE_EFFECT: Record<CmsMode, string> = {
  draft: 'O artigo aprovado chega ao WordPress como rascunho. A publicação acontece no portal.',
  scheduled: 'O artigo entra na agenda do portal, na data escolhida na Entrega.',
  published: 'O artigo vai ao ar assim que é enviado.',
};

const REQUIRED_FIELDS: { key: keyof CmsConnection['requires']; label: string }[] = [
  { key: 'category', label: 'Editoria' },
  { key: 'excerpt', label: 'Linha fina' },
  { key: 'image', label: 'Imagem de destaque' },
];

/** The portal's default author, used for anyone not mapped. */
const NEWSROOM = 'wp-redacao';

const WORDPRESS = appDef('wordpress') as AppDef;
const WORDPRESS_GUIDE = guideOf('wordpress');

/**
 * WordPress (F2.10, REQ-2.10): the portal's CMS, where "Enviar ao CMS" of the Entrega sends. Not
 * connected, it is the guided connection (address, how it sends, test). Connected, in reading
 * order: the connection, what needs attention, how it sends and what it requires, who signs each
 * reporter's articles, where each topic of the editorial map lands, and the posts sent lately.
 */
export function CmsScreen() {
  const session = useSession();
  const allowed = useCan('pipeline.edit');
  useBreadcrumb([{ label: 'Integrações', href: INTEGRATIONS_HREF }, { label: 'WordPress' }]);
  if (session.status === 'loading') return <PageStack><PageHeader title="WordPress" /></PageStack>;
  if (!allowed) return <AdminOnly />;
  return <CmsPage />;
}

function CmsPage() {
  const desk = useHardNews();
  const store = useIntegrations();
  const session = useSession();
  const me = session.data?.current?.name ?? 'Você';
  const cms = desk.state.cms;

  if (!desk.ready || !store.ready) return <PageStack><PageHeader title="WordPress" /></PageStack>;
  if (cms.status !== 'disconnected') return <Connected cms={cms} />;

  const record: AppRecord = store.state.apps.wordpress ?? { state: 'disconnected', siteUrl: cms.siteUrl };
  const update = (patch: Partial<AppRecord>) => store.actions.updateApp('wordpress', { siteUrl: record.siteUrl, ...patch });
  return (
    <SetupPage
      def={WORDPRESS}
      record={record}
      update={update}
      configure={<SendPanel cms={cms} />}
      plan={testPlan('cms', record)}
      onFinish={() => {
        const siteUrl = record.siteUrl ?? cms.siteUrl;
        desk.actions.updateCms({ siteUrl, account: record.username ?? cms.account, status: 'connected', checkedAt: new Date().toISOString() });
        store.actions.updateApp('wordpress', { setup: undefined });
        store.actions.log({ kind: 'system', app: 'wordpress', ok: true, title: 'WordPress conectado', detail: `Por ${me}` });
        toast('WordPress conectado', { description: portalHost(siteUrl) });
        window.scrollTo({ top: 0 });
      }}
    />
  );
}

type Author = { name: string; title?: string; avatarUrl?: string };

function Connected({ cms }: { cms: CmsConnection }) {
  const { state, actions } = useHardNews();
  const store = useIntegrations();
  const session = useSession();
  const now = useNow();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const status = CMS_STATUS[cms.status];
  const host = portalHost(cms.siteUrl);
  const members = session.data?.members;

  const people = useMemo<Author[]>(() => {
    const known = new Map((members ?? []).map((member) => [member.name, member]));
    const names = new Set([...Object.keys(cms.authorMap), ...known.keys()]);
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((name) => ({ name, title: known.get(name)?.title, avatarUrl: known.get(name)?.avatarUrl }));
  }, [cms.authorMap, members]);
  const topics = state.map.topics;
  const categoryMap = store.state.categoryMap;

  const deliveries = Object.values(state.deliveries).filter((delivery) => (delivery.state === 'sent' && delivery.sentAt) || delivery.state === 'failed');
  const sent = deliveries.filter((delivery) => delivery.state === 'sent');
  const failed = deliveries.filter((delivery) => delivery.state === 'failed');
  const lastSent = sent.map((delivery) => delivery.sentAt ?? '').sort().pop();

  const checks = cmsChecks({
    status: cms.status,
    host,
    unmappedPeople: people.filter((person) => !cms.authorMap[person.name]).map((person) => person.name),
    unmappedTopics: topics.filter((topic) => !categoryMap[topic.id]).map((topic) => topic.label),
    failedSends: failed.length,
  });

  async function test() {
    setTesting(true);
    const ok = await actions.testCms();
    setTesting(false);
    store.actions.log({ kind: 'system', app: 'wordpress', ok, title: ok ? 'Conexão testada' : 'O portal não respondeu', detail: host });
    if (ok) toast('Conexão funcionando', { description: host });
    else toast('O portal não respondeu', { tone: 'error', description: 'Confira o endereço e teste de novo.' });
  }

  return (
    <>
      <PageStack>
        <PageHeader
          title="WordPress"
          status={<Badge tone={status.tone} variant="soft" dot>{status.label}</Badge>}
          actions={<Button variant="secondary" icon={RefreshCw} loading={testing} onClick={() => void test()}>Testar conexão</Button>}
          more={(
            <Menu
              label="Mais ações"
              align="end"
              sections={[{ items: [{ label: 'Desconectar', icon: Unlink, danger: true, onSelect: () => setDisconnecting(true) }] }]}
              trigger={(props) => <IconButton {...props} label="Mais ações" icon={Ellipsis} variant="ghost" />}
            />
          )}
        />
        <ConnectionPanel
          name="WordPress"
          logo={WORDPRESS.logo}
          title={host}
          description={[`Usuário ${cms.account}`, cms.checkedAt && now ? `testado ${formatAgo(cms.checkedAt, now)}` : undefined].filter(Boolean).join(' · ')}
          metrics={[
            { label: 'Envios', value: String(sent.length) },
            { label: 'Último envio', value: lastSent && now ? formatAgo(lastSent, now) : '—' },
            { label: 'Chega como', value: CMS_MODE_LABELS[cms.mode] },
          ]}
        />
        <HealthTray checks={checks} />
        <SendPanel cms={cms} />
        <AuthorsPanel cms={cms} people={people} />
        <CategoriesPanel cms={cms} topics={topics} map={categoryMap} onMap={store.actions.mapCategory} />
        <SendsPanel deliveries={deliveries} />
        {WORDPRESS_GUIDE ? <HowItWorksPanel guide={WORDPRESS_GUIDE} record={{ siteUrl: cms.siteUrl, credential: `Senha de aplicativo de ${cms.account}` }} /> : null}
      </PageStack>
      <ConfirmDialog
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        title={`Desconectar ${host}?`}
        description="Os posts já enviados continuam no portal."
        confirmLabel="Desconectar"
        tone="danger"
        onConfirm={() => {
          actions.updateCms({ status: 'disconnected' });
          store.actions.updateApp('wordpress', { siteUrl: cms.siteUrl, setup: undefined });
          store.actions.log({ kind: 'system', app: 'wordpress', ok: true, title: 'WordPress desconectado', detail: host });
          setDisconnecting(false);
          toast('Portal desconectado');
        }}
      />
    </>
  );
}

/** How "Enviar ao CMS" sends (R2 sends drafts) and what the portal refuses without. */
function SendPanel({ cms }: { cms: CmsConnection }) {
  const { actions } = useHardNews();
  return (
    <Panel label="Envio">
      <Section
        title="Modo de envio"
        id="envio"
        action={<Segmented label="Modo de envio" size="sm" value={cms.mode} options={MODE_OPTIONS} onChange={(mode) => actions.updateCms({ mode })} />}
      >
        <Prose variant="compact" measure="wide">{MODE_EFFECT[cms.mode]}</Prose>
      </Section>
      <Section title="Campos obrigatórios">
        {REQUIRED_FIELDS.map((field) => (
          <SwitchRow
            key={field.key}
            label={field.label}
            checked={cms.requires[field.key]}
            onCheckedChange={(checked) => actions.updateCms({ requires: { ...cms.requires, [field.key]: checked } })}
          />
        ))}
      </Section>
    </Panel>
  );
}

/** Na redação → No portal: who signs each person's articles. Unmapped people sign as the newsroom. */
function AuthorsPanel({ cms, people }: { cms: CmsConnection; people: Author[] }) {
  const { actions } = useHardNews();
  const options = cms.authors.map((author) => ({ value: author.id, label: author.id === NEWSROOM ? `${author.label} (padrão)` : author.label }));
  const mapped = people.filter((person) => cms.authorMap[person.name]).length;
  const columns: Column<Author>[] = [
    {
      key: 'person',
      header: 'Na redação',
      render: (person) => (
        <CardHeader titleAs="h3" leading={<Avatar name={person.name} src={person.avatarUrl} size="sm" decorative />} title={person.name} description={person.title} />
      ),
    },
    {
      key: 'author',
      header: 'No portal',
      width: 240,
      render: (person) => (
        <Select
          label={`Autor no portal para ${person.name}`}
          size="sm"
          value={cms.authorMap[person.name] ?? NEWSROOM}
          options={options}
          onChange={(authorId) => actions.updateCms({ authorMap: { ...cms.authorMap, [person.name]: authorId } })}
        />
      ),
    },
  ];
  return (
    <Panel label="Autores">
      <Section title="Autores" id="autores" meta={`${mapped} de ${people.length} com autor próprio`}>
        <DataTable label="Autor no portal de cada pessoa" rows={people} rowKey={(person) => person.name} rowLabel={(person) => person.name} columns={columns} />
      </Section>
    </Panel>
  );
}

/** Tema no mapa editorial → Categoria no portal: what the Entrega suggests for each topic. */
function CategoriesPanel({ cms, topics, map, onMap }: {
  cms: CmsConnection;
  topics: EditorialTopic[];
  map: Record<string, string>;
  onMap: (topicId: string, categoryId: string) => void;
}) {
  const options = cms.categories.map((category) => ({ value: category.id, label: category.label }));
  const mapped = topics.filter((topic) => map[topic.id]).length;
  const columns: Column<EditorialTopic>[] = [
    { key: 'topic', header: 'No mapa editorial', render: (topic) => topic.label },
    {
      key: 'category',
      header: 'No portal',
      width: 240,
      render: (topic) => (
        <Select
          label={`Categoria no portal para ${topic.label}`}
          size="sm"
          placeholder="Escolher categoria"
          value={map[topic.id] ?? ''}
          options={options}
          invalid={!map[topic.id]}
          onChange={(categoryId) => onMap(topic.id, categoryId)}
        />
      ),
    },
  ];
  return (
    <Panel label="Categorias">
      <Section title="Categorias" id="categorias" meta={`${mapped} de ${topics.length} temas`} metaTone={mapped < topics.length ? 'missing' : 'muted'}>
        <DataTable label="Categoria no portal de cada tema" rows={topics} rowKey={(topic) => topic.id} rowLabel={(topic) => topic.label} columns={columns} />
      </Section>
    </Panel>
  );
}

const SEND_STATE: Record<'sent' | 'failed', { label: string; tone: 'green' | 'red' }> = {
  sent: { label: 'Enviado', tone: 'green' },
  failed: { label: 'Falhou', tone: 'red' },
};

/** The posts sent lately, and the ones that failed with the way back to their Entrega. */
function SendsPanel({ deliveries }: { deliveries: CmsDelivery[] }) {
  const workspaceHrefFor = useWorkspaceHref();
  const { state } = useHardNews();
  const now = useNow();
  const phone = usePhone();
  const rows = [...deliveries].sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? '')).slice(0, 8);
  const titleOf = (productionId: string) => {
    const dossier = state.dossiers[productionId];
    return dossier?.outline?.headline ?? state.news.find((item) => item.id === dossier?.newsId)?.title ?? 'Artigo';
  };
  const columns: Column<CmsDelivery>[] = [
    { key: 'title', header: 'Artigo', truncate: !phone, render: (delivery) => titleOf(delivery.productionId) },
    {
      key: 'state',
      header: 'Estado',
      width: 112,
      render: (delivery) => {
        const look = SEND_STATE[delivery.state === 'failed' ? 'failed' : 'sent'];
        return <Badge variant="text" size="sm" dot tone={look.tone}>{look.label}</Badge>;
      },
    },
    { key: 'post', header: 'Post', width: 88, numeric: true, render: (delivery) => delivery.remoteId, fallback: '—' },
    { key: 'when', header: 'Enviado', width: 112, render: (delivery) => (delivery.sentAt && now ? formatAgo(delivery.sentAt, now) : undefined), fallback: '—' },
    {
      key: 'open',
      header: '',
      width: 128,
      align: 'end',
      render: (delivery) => (delivery.state === 'failed'
        ? <ButtonLink as={Link} href={workspaceHrefFor(deliveryHref(delivery.productionId))} size="sm" variant="secondary">Abrir entrega</ButtonLink>
        : delivery.url ? <TextLink href={workspaceHrefFor(delivery.url)} external>Abrir no CMS</TextLink> : undefined),
    },
  ];
  return (
    <Panel label="Envios">
      <Section title="Envios" id="envios">
        <DataTable
          label="Últimos envios ao CMS"
          rows={rows}
          rowKey={(delivery) => delivery.productionId}
          rowLabel={(delivery) => titleOf(delivery.productionId)}
          columns={columns}
          empty="Os artigos enviados pela Entrega aparecem aqui."
        />
      </Section>
    </Panel>
  );
}
