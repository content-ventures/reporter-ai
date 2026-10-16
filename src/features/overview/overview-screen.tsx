'use client';

import { Suspense, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ErrorState, PageHeader, PageStack, SplitLayout, MetricStrip, Panel, Section, TextLink } from '@content-ventures/design-system/v3';
import type { OverviewData } from '@/ports';
import { dashboardWidgetsFor } from '@/registries';
import { useOverview, useSession } from '@/state';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { NewProductionLink } from '@/features/new-production/new-production-link';
import { StartWritingButton } from '@/features/new-production/start-writing-button';
import { usePhone } from '@/ui/use-phone';
import { useNow } from '@/ui/time';
import { deskSummary } from './desk-copy';
import { InProgressPanel } from './in-progress-panel';
import { NeedsYouPanel } from './needs-you-panel';
import { RecentActivity } from './recent-activity';
import { parseRange, type OverviewRangeKey } from './overview-format';
import { FeaturedProduction } from './featured-production';
import { TemplateStrip } from './template-strip';
import { WeekLine } from './week-line';

/** Start work, resume a production and resolve the viewer’s pending actions. */

type BodyProps = { range: OverviewRangeKey; onRangeChange: (range: OverviewRangeKey) => void };

/** Widgets of the current release (dashboard registry): later releases plug in by adding entries. */
const WIDGETS = new Set(dashboardWidgetsFor().map((widget) => widget.id));
const shows = (id: string) => WIDGETS.has(id);

const TITLE = 'Início';
const STAGES = [
  { stage: 'material', label: 'Material' },
  { stage: 'writing', label: 'Artigo' },
  { stage: 'approval', label: 'Aprovação' },
  { stage: 'carousel', label: 'Carrossel' },
  { stage: 'delivery', label: 'Entrega' },
] as const;

/** "Bom dia, Pedro. 2 peças esperam sua aprovação." once the desk, the viewer and the clock exist. */
function useSummary(data: OverviewData | undefined): string | undefined {
  const session = useSession();
  const now = useNow();
  if (!data || !now || session.status === 'loading') return undefined;
  return deskSummary({ hour: now.getHours(), name: session.data?.current?.name, groups: data.desk.groups });
}

function OverviewBody({ range, onRangeChange }: BodyProps) {
  const query = useOverview(range);
  const phone = usePhone();
  // Switching the window keeps the last answer on screen until the new one arrives (no skeleton flash).
  const [last, setLast] = useState<OverviewData | undefined>(undefined);
  if (query.status === 'ready' && query.data !== last) setLast(query.data);
  const data = query.status === 'ready' ? query.data : last;
  const summary = useSummary(data);
  // The week line names the window of the data on screen until the new window arrives.
  const shownRange = data?.range ?? range;

  if (query.status === 'error' && data === undefined) {
    return (
      <PageStack>
        <PageHeader title={TITLE} actions={<><NewProductionLink /><StartWritingButton /></>} />
        <ErrorState size="panel" title="Não foi possível carregar o Início" description={query.error?.message} onRetry={query.retry} />
      </PageStack>
    );
  }

  const featured = <FeaturedProduction item={data?.desk.continueWith ?? data?.desk.inProgress[0]} loading={!data} />;
  const recent = shows('in-progress') && !data?.empty && <InProgressPanel desk={data?.desk} />;
  const pending = shows('needs-you') && <NeedsYouPanel desk={data?.desk} />;
  const activity = shows('team') && <RecentActivity items={data?.activity} />;
  const stages = shows('team') && <Panel><Section title="Produções por etapa" action={<TextLink href={PRODUCTIONS_HREF} size="sm">Abrir kanban</TextLink>}>
    <MetricStrip label="Contagem por etapa" items={STAGES.map(({ stage, label }) => ({ label,
      value: data?.desk.team.find(group => group.stage === stage)?.items.length ?? 0, loading: !data,
    }))} />
  </Section></Panel>;

  return (
    <PageStack>
      {/* A non-breaking space keeps the sentence's line while it loads (no jump under the title). */}
      <PageHeader
        title={TITLE}
        description={summary ?? ' '}
        actions={
          <>
            <NewProductionLink />
            <StartWritingButton />
          </>
        }
      />
      {phone ? <PageStack>{featured}{pending}{recent}<TemplateStrip />{stages}{activity}</PageStack>
        : <SplitLayout main={<>{featured}{recent}<TemplateStrip /></>} asideLabel="Sua mesa de trabalho"
            aside={<>{pending}{stages}{activity}</>} />}
      {shows('week') && data && <WeekLine week={data.desk.week} shownRange={shownRange} range={range} onRangeChange={onRangeChange} />}
    </PageStack>
  );
}

/** The window lives in the URL (`?range=30d`); 7 days is the clean URL. */
function OverviewWithRange() {
  const params = useSearchParams();
  const pathname = usePathname();
  const range = parseRange(params.get('range'));

  function changeRange(next: OverviewRangeKey) {
    // From the address bar as it is now: `useSearchParams` may still hold `?reset=1`, which the
    // runtime already consumed — writing it back would wipe the local work on the next reload.
    const search = new URLSearchParams(window.location.search);
    search.delete('reset');
    if (next === '7d') search.delete('range');
    else search.set('range', next);
    const query = search.toString();
    window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
  }

  return <OverviewBody range={range} onRangeChange={changeRange} />;
}

const ignoreRange = () => {};

export function OverviewScreen() {
  return (
    <Suspense fallback={<OverviewBody range="7d" onRangeChange={ignoreRange} />}>
      <OverviewWithRange />
    </Suspense>
  );
}
