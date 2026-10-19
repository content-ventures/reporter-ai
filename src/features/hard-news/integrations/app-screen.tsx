'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Menu,
  PageHeader,
  PageStack,
  toast,
} from '@content-ventures/design-system/v3';
import type { MetricProps } from '@content-ventures/design-system/v3';
import { Ellipsis, RefreshCw, Unlink } from '@content-ventures/design-system/v3/icons';
import { useCan, useSession } from '@/state';
import { formatAgo } from '@/ui/approval-copy';
import { useBreadcrumb } from '@/ui/shell';
import { useNow } from '@/ui/time';
import { AppConfig } from './app-config';
import { ActivityPanel, ConnectionPanel, HealthTray, HowItWorksPanel } from './app-parts';
import { SetupPage } from './app-setup';
import { guideOf } from './integrations-guides';
import { AdminOnly } from './integrations-screen';
import { appChecks, appDef, STATUS_META, statusOf, testPlan } from './integrations-model';
import type { ActivityEntry, AppDef, AppId, AppRecord } from './integrations-model';
import { useIntegrations } from './integrations-store';
import { INTEGRATIONS_HREF } from './use-catalog';
import { WebhooksScreen } from './webhooks-screen';
import { NewsSourcePage } from './news-source-page';
import { useHardNews } from '../state/hard-news-provider';

const TEST_MS = 1200;
const DAY = 24 * 60 * 60_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page of one app of the catalog: its connection, or the guided connection while it has none. */
export function AppScreen({ id }: { id: AppId }) {
  const def = appDef(id);
  const session = useSession();
  const allowed = useCan('pipeline.edit');
  const { live } = useHardNews();
  useBreadcrumb([{ label: 'Integrações', href: INTEGRATIONS_HREF }, { label: def?.name ?? 'Integração' }]);
  if (!def) return null;
  if (session.status === 'loading') return <PageStack><PageHeader title={def.name} /></PageStack>;
  if (!allowed) return <AdminOnly />;
  if (def.kind === 'webhooks') return <WebhooksScreen />;
  // F2.1: in the connected build, the news-source apps are the server's sources.
  if (live && (def.id === 'google-alerts' || def.id === 'rss-app')) return <NewsSourcePage def={def} />;
  return <AppPage def={def} />;
}

function AppPage({ def }: { def: AppDef }) {
  const { state, ready, actions } = useIntegrations();
  const session = useSession();
  const me = session.data?.current?.name ?? 'Você';
  const record: AppRecord = state.apps[def.id] ?? { state: 'disconnected' };
  const update = (patch: Partial<AppRecord>) => actions.updateApp(def.id, patch);

  if (!ready) return <PageStack><PageHeader title={def.name} /></PageStack>;
  if (record.state === 'disconnected') {
    return (
      <SetupPage
        def={def}
        record={record}
        update={update}
        configure={<AppConfig def={def} record={record} update={update} />}
        plan={testPlan(def.kind, record)}
        onFinish={() => {
          actions.connectApp(def.id, { account: record.setup?.account }, me);
          actions.log({ kind: 'system', app: def.id, ok: true, title: `${def.name} conectado`, detail: `Por ${me}` });
          toast(`${def.name} conectado`, { description: record.setup?.account });
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }
  return <ManagedPage def={def} record={record} />;
}

/** A connected app, in reading order: the connection, what needs attention, its settings, its activity. */
function ManagedPage({ def, record }: { def: AppDef; record: AppRecord }) {
  const { state, actions } = useIntegrations();
  const now = useNow();
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const status = STATUS_META[statusOf(def, record.state)];
  const activity = state.activity.filter((entry) => entry.app === def.id);
  const update = (patch: Partial<AppRecord>) => actions.updateApp(def.id, patch);
  const guide = guideOf(def.id);

  async function test() {
    setTesting(true);
    await wait(TEST_MS);
    setTesting(false);
    update({ state: 'connected', checkedAt: new Date().toISOString(), error: undefined });
    actions.log({ kind: 'system', app: def.id, ok: true, title: 'Conexão testada', detail: record.account });
    toast('Conexão funcionando', { description: record.account });
  }

  const since = record.connectedAt && now ? formatAgo(record.connectedAt, now) : undefined;
  return (
    <>
      <PageStack>
        <PageHeader
          title={def.name}
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
          name={def.name}
          logo={def.logo}
          title={record.account ?? def.name}
          description={[record.connectedBy ? `Conectado por ${record.connectedBy}` : 'Conectado', since].filter(Boolean).join(' · ')}
          metrics={metricsOf(def, record, activity, now)}
        />
        <HealthTray checks={appChecks(def, record)} />
        <AppConfig def={def} record={record} update={update} />
        {guide ? <HowItWorksPanel guide={guide} record={{ ...record, credential: record.credential ?? (def.auth === 'oauth' ? 'Token OAuth, guardado no servidor' : undefined) }} /> : null}
        <ActivityPanel name={def.name} entries={activity} />
      </PageStack>
      <ConfirmDialog
        open={disconnecting}
        onClose={() => setDisconnecting(false)}
        title={`Desconectar ${def.name}?`}
        description={def.kind === 'chat' || def.kind === 'email' ? 'Os avisos param de chegar.' : 'As configurações ficam guardadas para a próxima conexão.'}
        confirmLabel="Desconectar"
        tone="danger"
        onConfirm={() => {
          actions.disconnectApp(def.id);
          actions.log({ kind: 'system', app: def.id, ok: true, title: `${def.name} desconectado` });
          setDisconnecting(false);
          toast(`${def.name} desconectado`);
        }}
      />
    </>
  );
}

const thousands = (value: number) => value.toLocaleString('pt-BR');

/** What went through the app lately, as figures under the lockup. */
function metricsOf(def: AppDef, record: AppRecord, activity: ActivityEntry[], now: Date | undefined): MetricProps[] | undefined {
  const work = activity.filter((entry) => entry.kind !== 'system');
  const last = work[0];
  const lastAt = last && now ? formatAgo(last.at, now) : '—';
  const today = now ? work.filter((entry) => now.getTime() - new Date(entry.at).getTime() < DAY).length : 0;
  if (def.kind === 'chat') {
    return [
      { label: 'Avisos em 24 h', value: String(today) },
      { label: 'Avisos ligados', value: `${record.rules?.filter((rule) => rule.on).length ?? 0} de ${record.rules?.length ?? 0}` },
      { label: 'Último aviso', value: lastAt },
    ];
  }
  if (def.kind === 'images' && record.usage) {
    const ratio = record.usage.limit ? record.usage.used / record.usage.limit : 0;
    return [
      { label: `Uso ${record.usage.period}`, value: thousands(record.usage.used), hint: `de ${thousands(record.usage.limit)}`, meter: { value: ratio * 100, tone: ratio >= 0.8 ? 'amber' : 'blue' } },
      { label: 'Fotos salvas', value: String(work.filter((entry) => entry.kind === 'photo').length) },
      { label: 'Último uso', value: lastAt },
    ];
  }
  if (def.kind === 'email') {
    return [
      { label: 'Destinatários', value: String(record.recipients?.length ?? 0) },
      { label: 'Avisos ligados', value: String(record.rules?.filter((rule) => rule.on).length ?? 0) },
      { label: 'Último envio', value: lastAt },
    ];
  }
  return undefined;
}
