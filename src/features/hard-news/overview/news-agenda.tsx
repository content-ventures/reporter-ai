'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import {
  ButtonLink,
  Grid,
  Panel,
  Prose,
  Section,
} from '@content-ventures/design-system/v3';
import { priorityOf } from '@/domain/hard-news';
import { useNow } from '@/ui/time';
import { DemoBadge } from '../demo-badge';
import { NewsCard } from '../news/news-card';
import { heroOf, queueOf } from '../news/radar-model';
import { NEWS_HREF } from '../routes';
import { useOptionalHardNews } from '../state/hard-news-provider';
import { coveredToday } from '../state/hard-news-state';

const SHOWN = 6;

/** Opens the news desk on this item. */
export function newsItemHref(id: string): string {
  return `${NEWS_HREF}?item=${encodeURIComponent(id)}`;
}

/**
 * Início · "Pauta do dia" (dashboard widget `news-queue`, R2): the stories the radar asks to cover
 * first, then the newest, as the same cards the desk shows, and the day's goal. Each
 * card opens the story on the desk.
 */
export function NewsAgenda() {
  const workspaceHrefFor = useWorkspaceHref();
  const desk = useOptionalHardNews();
  const clock = useNow();
  if (!desk || !clock) return null;
  const now = clock.getTime();
  const queue = queueOf(desk.state.news, '').filter((item) => item.classification);
  const { hero } = heroOf(queue, SHOWN);
  const shown = [...hero, ...queue.filter((item) => !hero.includes(item))].slice(0, SHOWN);
  const high = queue.filter((item) => priorityOf(item) === 'high').length;
  const covered = coveredToday(desk.state.news, now);
  const goal = desk.state.goal.perDay;

  return (
    <Panel label="Pauta do dia">
      <Section
        title="Pauta do dia"
        meta={[queue.length ? `${queue.length} para decidir · ${high} com prioridade alta` : undefined, `${covered} de ${goal} pautas hoje`].filter(Boolean).join(' · ')}
        action={<><DemoBadge /><ButtonLink href={workspaceHrefFor(NEWS_HREF)} variant="ghost" size="sm">Abrir radar</ButtonLink></>}
      >
        {shown.length ? (
          <Grid columns="1:1:1" collapseBelow={1024} as="ul" label="Pauta do dia">
            {shown.map((item) => <NewsCard key={item.id} item={item} now={now} href={workspaceHrefFor(newsItemHref(item.id))} showPriority />)}
          </Grid>
        ) : (
          <Prose variant="compact" measure="wide">A fila está em dia.</Prose>
        )}
      </Section>
    </Panel>
  );
}
