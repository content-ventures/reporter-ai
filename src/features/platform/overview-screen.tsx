'use client';

import { useState } from 'react';
import { Avatar, Banner, ButtonLink, EmptyState, Grid, List, ListItem, ListItemSkeleton, MetaList, PageHeader, PageStack, Section, TextLink } from '@content-ventures/design-system/v3';
import { ScrollText, UserPlus } from '@content-ventures/design-system/v3/icons';
import { DEFAULT_USAGE_PERIOD, PLATFORM_ACTION_LABELS, type PlatformPerson, type UsagePeriod } from '@/domain';
import { usePlatformDirectory, usePlatformLog, usePlatformUsage } from '@/state';
import { plural } from '@/ui/format';
import { RelativeTime } from '@/ui/time';
import { formatCompact, formatUsd, LOG_HREF, PEOPLE_HREF, rolesLabel, USAGE_HREF } from './format';
import { ActivityChart, ModelShare, UsageStrip } from './usage-blocks';

const personHref = (person: Pick<PlatformPerson, 'id'>) => `${PEOPLE_HREF}?person=${encodeURIComponent(person.id)}`;

/**
 * Visão geral: the period's indicators against the one before, the daily activity, the share of
 * each model, who used the most, and the last console actions. Sign-ups waiting for release are
 * the one thing that asks for action, so they open the page.
 */
export function OverviewScreen() {
  const [period, setPeriod] = useState<UsagePeriod>(DEFAULT_USAGE_PERIOD);
  const usage = usePlatformUsage(period);
  const directory = usePlatformDirectory();
  const pendingDirectory=usePlatformDirectory({status:'pending',limit:5});
  const log = usePlatformLog(6);
  const report = usage.data;
  const people = directory.data?.people ?? [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const waiting = (pendingDirectory.data?.people??[]).filter((person) => person.status === 'pending');
  const waitingCount=pendingDirectory.data?.counts?.pending??waiting.length;
  const top = (report?.people ?? []).filter((entry) => byId.has(entry.personId)).slice(0, 5);

  return (
    <>
      <PageHeader title="Visão geral" actions={<ButtonLink href={`${PEOPLE_HREF}?new=1`} variant="primary" icon={UserPlus}>Novo acesso</ButtonLink>} />
      <PageStack>
        {waitingCount > 0 ? (
          <Banner
            variant="inline"
            tone="warning"
            title={waitingCount === 1&&waiting[0] ? `${waiting[0].name} aguarda liberação` : `${plural(waitingCount, 'cadastro aguarda', 'cadastros aguardam')} liberação`}
            action={<ButtonLink size="sm" href={waitingCount === 1&&waiting[0] ? personHref(waiting[0]) : PEOPLE_HREF}>Revisar</ButtonLink>}
          />
        ) : null}
        <UsageStrip report={report} period={period} loading={usage.status === 'loading'} />
        <Grid columns="2:1" collapseBelow={1024}>
          <ActivityChart report={report} period={period} onPeriodChange={setPeriod} />
          <ModelShare report={report} />
        </Grid>
        <Grid columns="1:1">
          <Section title="Quem mais usou" titleAs="h2" variant="panel" action={<TextLink href={USAGE_HREF}>Ver uso</TextLink>}>
            <List label="Quem mais usou" framed={false} bleed empty={<EmptyState size="inline" title="Sem uso no período" />}>
              {!report ? [0, 1, 2].map((index) => <ListItemSkeleton key={index} />) : top.map((entry) => {
                const person = byId.get(entry.personId) as PlatformPerson;
                return (
                  <ListItem
                    key={entry.personId}
                    href={personHref(person)}
                    leading={<Avatar name={person.name} src={person.avatarUrl} size="sm" decorative />}
                    title={person.name}
                    description={<MetaList size="sm" wrap={false} items={[plural(entry.generations, 'geração', 'gerações'), plural(entry.productions, 'produção', 'produções'), `${formatCompact(entry.tokens)} tokens`]} />}
                    trailing={formatUsd(entry.costUsd)}
                  />
                );
              })}
            </List>
          </Section>
          <Section title="Últimas ações" titleAs="h2" variant="panel" action={<TextLink href={LOG_HREF}>Ver registro</TextLink>}>
            <List label="Últimas ações" framed={false} bleed empty={<EmptyState size="inline" icon={ScrollText} title="Nenhuma ação ainda" />}>
              {!log.data ? [0, 1, 2].map((index) => <ListItemSkeleton key={index} />) : log.data.items.map((entry) => (
                <ListItem
                  key={entry.id}
                  leading={<Avatar name={entry.actor?.name ?? entry.target?.name ?? 'Pessoa'} src={entry.actor?.avatarUrl} size="sm" decorative />}
                  title={`${PLATFORM_ACTION_LABELS[entry.action]??entry.action}${entry.target ? ` · ${entry.target.name}` : ''}`}
                  description={<MetaList size="sm" wrap={false} items={[entry.actor ? entry.actor.name : 'A própria pessoa', ...(entry.roles?.length ? [rolesLabel(entry.roles)] : [])]} />}
                  trailing={<RelativeTime at={entry.at} />}
                />
              ))}
            </List>
          </Section>
        </Grid>
        {report ? (
          <MetaList size="sm" items={[`Custo estimado com preços de ${report.pricesAsOf.split('-').reverse().join('/')}`]} />
        ) : null}
      </PageStack>
    </>
  );
}
