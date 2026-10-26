'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AttachedNote,
  Badge,
  BrandMark,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  EmptyState,
  Grid,
  IconTile,
  MetricStrip,
  Panel,
  ProgressSteps,
  Section,
  TextLink,
  Timeline,
  Tray,
} from '@content-ventures/design-system/v3';
import type { Column, DescriptionItem, MetricProps, ProgressStep } from '@content-ventures/design-system/v3';
import type { LucideIcon } from '@content-ventures/design-system/v3/icons';
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  CheckCircle2,
  Clock,
  Gauge,
  KeyRound,
  ListChecks,
  Mail,
  Send,
  Tags,
  UsersRound,
  XCircle,
} from '@content-ventures/design-system/v3/icons';
import { PRODUCT_NAME } from '@/lib/brand';
import { formatAgo } from '@/ui/approval-copy';
import { useNow } from '@/ui/time';
import { apiBase, stepHref } from './integrations-guides';
import type { ApiCall, ConnectGuide, FieldValues } from './integrations-guides';
import { overall } from './integrations-model';
import type { ActivityEntry, AppRecord, CheckState, HealthCheck } from './integrations-model';

const CHECK_STATE: Record<CheckState, { label: string; tone: 'green' | 'amber' | 'red' }> = {
  ok: { label: 'Em dia', tone: 'green' },
  warn: { label: 'Atenção', tone: 'amber' },
  error: { label: 'Com erro', tone: 'red' },
};

const CHECK_ICONS: Record<string, LucideIcon> = {
  auth: KeyRound,
  rules: Bell,
  recipients: Mail,
  usage: Gauge,
  queries: Tags,
  events: ListChecks,
  authors: UsersRound,
  categories: Tags,
  sends: Send,
};

/** Section anchors that "Corrigir" scrolls to. */
export const ANCHORS: Record<string, string> = {
  auth: 'conexao',
  rules: 'avisos',
  recipients: 'destinatarios',
  usage: 'conexao',
  queries: 'alertas',
  events: 'eventos',
  authors: 'autores',
  categories: 'categorias',
  sends: 'envios',
};

/**
 * The connection at a glance: Reporter IA and the app side by side, joined, with who answered the
 * authorization; under it, what went through it lately, or the connect flow's ruler.
 */
export function ConnectionPanel({ name, logo, title, description, metrics, actions, children }: {
  name: string;
  /** The app's logo (`AppDef.logo`); without it, the DS glyph. */
  logo?: string;
  title: ReactNode;
  description?: ReactNode;
  metrics?: MetricProps[];
  actions?: ReactNode;
  /** A block under the lockup (the connect flow's ruler). */
  children?: ReactNode;
}) {
  return (
    <Panel label="Conexão" padding="lg">
      <Section id="conexao">
        <CardHeader
          titleAs="h2"
          size="md"
          leading={(
            <>
              <BrandMark name={PRODUCT_NAME} src="/icon.svg" size="lg" />
              <IconTile icon={ArrowLeftRight} variant="paper" shape="circle" size="lg" />
              <BrandMark name={name} src={logo} size="lg" />
            </>
          )}
          title={title}
          description={description}
          actions={actions}
        />
      </Section>
      {metrics?.length ? (
        <Section>
          <MetricStrip size="figure" label={`Uso de ${name}`} items={metrics} />
        </Section>
      ) : null}
      {children ? <Section>{children}</Section> : null}
    </Panel>
  );
}

/** "Funcionamento": one card per check; a check that needs attention carries its fix under it. */
export function HealthTray({ checks }: { checks: HealthCheck[] }) {
  const worst = overall(checks);
  const pending = checks.filter((check) => check.state !== 'ok').length;
  return (
    <Tray title="Funcionamento" meta={worst === 'ok' ? 'Tudo em dia' : pending === 1 ? '1 ponto de atenção' : `${pending} pontos de atenção`}>
      <Grid columns={checks.length % 3 === 0 ? '1:1:1' : '1:1'} collapseBelow={760} label="Funcionamento">
        {checks.map((check) => <CheckCard key={check.id} check={check} />)}
      </Grid>
    </Tray>
  );
}

function CheckCard({ check }: { check: HealthCheck }) {
  const workspaceHrefFor = useWorkspaceHref();
  const state = CHECK_STATE[check.state];
  const card = (
    <Card padding="md">
      <CardHeader
        titleAs="h3"
        leading={<IconTile icon={CHECK_ICONS[check.id] ?? CheckCircle2} size="md" />}
        title={check.label}
        badge={<Badge variant="text" size="sm" tone={state.tone} dot>{state.label}</Badge>}
        description={check.state === 'ok' ? check.detail : undefined}
      />
    </Card>
  );
  if (check.state === 'ok') return card;
  const anchor = ANCHORS[check.id];
  return (
    <AttachedNote
      tone={check.state === 'error' ? 'red' : 'amber'}
      icon={check.state === 'error' ? XCircle : AlertTriangle}
      note={<>{check.detail} {check.fix && anchor ? <TextLink href={workspaceHrefFor(`#${anchor}`)} size="sm" tone="inherit">{check.fix}</TextLink> : null}</>}
    >
      {card}
    </AttachedNote>
  );
}

export type TestCheck = { id: string; label: string; meta?: string };

/**
 * "Testar": runs the checks one after the other (the backend answers each); every line says what
 * it found. The parent remounts it (`key`) for every run.
 */
export function TestRun({ plan, running, onDone }: { plan: TestCheck[]; running: boolean; onDone: () => void }) {
  const [step, setStep] = useState(running ? 0 : -1);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!running) return;
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setStep(index);
      if (index >= plan.length) {
        window.clearInterval(timer);
        done.current();
      }
    }, 650);
    return () => window.clearInterval(timer);
  }, [running, plan.length]);

  const steps: ProgressStep[] = plan.map((check, index) => ({
    id: check.id,
    label: check.label,
    state: step < 0 ? 'upcoming' : index < step ? 'done' : index === step ? 'current' : 'upcoming',
    ...(index < step && check.meta ? { meta: check.meta } : {}),
  }));
  return <ProgressSteps label="Teste da conexão" steps={steps} />;
}

/** What went through the connection lately, newest first. */
export function ActivityPanel({ entries, name, empty = 'Nada passou por aqui ainda.' }: { entries: ActivityEntry[]; name: string; empty?: string }) {
  const now = useNow();
  return (
    <Panel label="Atividade">
      <Section title="Atividade" id="atividade">
        {entries.length === 0 ? (
          <EmptyState size="inline" icon={Clock} title={empty} />
        ) : (
          <Timeline
            variant="activity"
            label={`Atividade de ${name}`}
            items={entries.slice(0, 8).map((entry) => ({
              id: entry.id,
              title: entry.title,
              description: entry.detail,
              date: now ? formatAgo(entry.at, now) : undefined,
              dateTime: entry.at,
              marker: <IconTile icon={entry.ok ? CheckCircle2 : XCircle} tone={entry.ok ? 'gray' : 'red'} size="xs" />,
            }))}
          />
        )}
      </Section>
    </Panel>
  );
}

/**
 * What the person does in the other app, numbered, each step with the link to the exact page (a
 * path on the site typed appears once the address is valid).
 */
export function GuideSteps({ guide, values, name }: { guide: ConnectGuide; values: FieldValues; name: string }) {
  const workspaceHrefFor = useWorkspaceHref();
  return (
    <Timeline
      variant="steps"
      label={`Como conectar o ${name}`}
      items={guide.steps.map((step, index) => {
        const href = stepHref(step, values);
        return {
          id: `step-${index}`,
          title: step.title,
          description: step.detail,
          state: 'upcoming' as const,
          extra: href && step.link ? <TextLink href={workspaceHrefFor(href)} size="sm" external>{step.link.label}</TextLink> : undefined,
        };
      })}
    />
  );
}

/**
 * How the connection works once it is on: the method, where the Reporter IA calls, how it signs
 * in, the credential it keeps (never the secret), what the app allowed, and every call it makes.
 */
export function HowItWorksPanel({ guide, record }: { guide: ConnectGuide; record: Pick<AppRecord, 'siteUrl' | 'apiUrl' | 'credential'> }) {
  const base = apiBase(guide, record);
  const items: DescriptionItem[] = [
    { label: 'Método', value: guide.method },
    { label: 'Endereço', value: base, ...(base.startsWith('http') ? { copy: base } : {}) },
    { label: 'Autenticação', value: guide.auth },
    record.credential ? { label: 'Credencial', value: record.credential } : { label: 'Credencial', state: 'empty' },
    ...(guide.scopes ? [{ label: 'Permissões', value: guide.scopes.map((scope) => scope.id).join(', ') }] : []),
    ...(guide.limits ? [{ label: 'Limite', value: guide.limits }] : []),
  ];
  const columns: Column<ApiCall>[] = [
    { key: 'method', header: 'Método', width: 88, render: (call) => call.method },
    { key: 'path', header: 'Caminho', render: (call) => call.path },
    { key: 'purpose', header: 'Para quê', render: (call) => call.purpose },
  ];
  return (
    <Panel label="Como funciona">
      <Section title="Como funciona" id="api">
        <DescriptionList label="Como a conexão funciona" items={items} />
      </Section>
      <Section title="Chamadas à API" meta={guide.calls.length === 1 ? '1 chamada' : `${guide.calls.length} chamadas`}>
        <DataTable label="Chamadas que o Reporter IA faz" rows={guide.calls} rowKey={(call) => `${call.method} ${call.path}`} rowLabel={(call) => call.purpose} columns={columns} />
      </Section>
    </Panel>
  );
}
