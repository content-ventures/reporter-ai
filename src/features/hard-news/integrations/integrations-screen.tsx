'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import Link from 'next/link';
import { useState } from 'react';
import {
  AccessState,
  AttachedNote,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  FilterBar,
  Grid,
  MetaList,
  PageHeader,
  PageStack,
  SearchField,
  Tabs,
  TextLink,
  Tray,
} from '@content-ventures/design-system/v3';
import type { TabItem } from '@content-ventures/design-system/v3';
import { AlertTriangle, SearchX } from '@content-ventures/design-system/v3/icons';
import { useCan, useSession } from '@/state';
import { OVERVIEW_HREF } from '@/ui/routes';
import { catalogCounts, catalogGroups, isLive, STATUS_META } from './integrations-model';
import type { CatalogTab } from './integrations-model';
import { appHref, useCatalog } from './use-catalog';
import type { CatalogItem } from './use-catalog';

export { CMS_HREF } from './use-catalog';

/**
 * Integrações (admin): the apps the newsroom connects, by what they do for the desk (publish,
 * bring news, warn people, images, automation). Each app is a card with its mark, its state and
 * one action: Conectar opens the guided connection, Gerenciar opens its settings. What stopped
 * working carries the problem under the card.
 */
export function IntegrationsScreen() {
  const session = useSession();
  const allowed = useCan('pipeline.edit');
  if (session.status === 'loading') return <PageStack><PageHeader title="Integrações" /></PageStack>;
  if (!allowed) return <AdminOnly />;
  return <Catalog />;
}

export function AdminOnly() {
  const workspaceHrefFor = useWorkspaceHref();
  return (
    <AccessState
      kind="restricted"
      heading="h1"
      title="Integrações restritas a administradores"
      actions={<ButtonLink href={workspaceHrefFor(OVERVIEW_HREF)} variant="primary">Ir para o Início</ButtonLink>}
    />
  );
}

function Catalog() {
  const { items, ready } = useCatalog();
  const [tab, setTab] = useState<CatalogTab>('all');
  const [query, setQuery] = useState('');
  const counts = catalogCounts(items);
  const groups = catalogGroups(items, tab, query);
  const failing = items.filter((item) => item.status === 'failing').length;

  const tabs: TabItem<CatalogTab>[] = [
    { value: 'all', label: 'Todos', count: ready ? counts.all : undefined },
    { value: 'connected', label: 'Conectados', count: ready ? counts.connected : undefined },
    { value: 'available', label: 'Disponíveis', count: ready ? counts.available : undefined },
  ];

  return (
    <PageStack>
      <PageHeader
        title="Integrações"
        meta={ready ? [`${counts.connected} ${counts.connected === 1 ? 'conectado' : 'conectados'}`, ...(failing ? [`${failing} com erro`] : [])] : undefined}
      />
      <FilterBar
        filters={false}
        tabs={<Tabs label="Apps" items={tabs} value={tab} onChange={setTab} />}
        search={<SearchField size="sm" label="Buscar app" placeholder="Buscar app" value={query} onValueChange={setQuery} />}
      />
      {groups.length ? groups.map((group) => (
        <Tray key={group.id} title={group.label} meta={ready && group.live ? `${group.live} ${group.live === 1 ? 'conectado' : 'conectados'}` : undefined}>
          <Grid columns="1:1:1" collapseBelow={760} label={group.label}>
            {group.apps.map((app) => <AppCard key={app.id} app={app} ready={ready} />)}
          </Grid>
        </Tray>
      )) : (
        <EmptyState
          icon={SearchX}
          title="Nenhum app encontrado"
          actions={<Button variant="secondary" onClick={() => { setQuery(''); setTab('all'); }}>Limpar busca</Button>}
        />
      )}
    </PageStack>
  );
}

/** One app: mark, name and what it does; its state and facts; Conectar or Gerenciar. */
function AppCard({ app, ready }: { app: CatalogItem; ready: boolean }) {
  const workspaceHrefFor = useWorkspaceHref();
  const status = STATUS_META[app.status];
  const href = appHref(app.id);
  const live = isLive(app.status);
  const soon = app.status === 'soon';
  const facts = soon ? [`Chega na ${app.since}`] : app.facts;

  const card = (
    <Card padding="md" disabled={soon}>
      <PageStack>
        <CardHeader
          titleAs="h2"
          leading={<BrandMark name={app.name} src={app.logo} size="lg" />}
          title={app.name}
          description={app.summary}
          actions={ready && !soon ? (
            <ButtonLink as={Link} href={workspaceHrefFor(href)} size="sm" variant="secondary">{live ? 'Gerenciar' : 'Conectar'}</ButtonLink>
          ) : undefined}
        />
        {ready ? (
          <MetaList
            size="sm"
            label={`Estado de ${app.name}`}
            items={[
              <Badge key="status" variant="text" size="sm" tone={status.tone} dot={status.hollow ? 'hollow' : true}>{status.label}</Badge>,
              ...facts,
            ]}
          />
        ) : null}
      </PageStack>
    </Card>
  );

  if (!app.problem) return card;
  return (
    <AttachedNote
      tone={app.problem.tone}
      icon={AlertTriangle}
      note={<>{app.problem.text} <TextLink href={workspaceHrefFor(href)} size="sm" tone="inherit">{app.problem.fix}</TextLink></>}
    >
      {card}
    </AttachedNote>
  );
}
