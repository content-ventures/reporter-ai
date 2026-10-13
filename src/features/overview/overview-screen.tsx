'use client';

import { Suspense, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Accordion, Button, ButtonLink, EmptyState, ErrorState, PageHeader, PageStack, SplitLayout } from '@content-ventures/design-system/v3';
import { Inbox, Plus } from '@content-ventures/design-system/v3/icons';
import type { OverviewData } from '@/ports';
import { dashboardWidgetsFor } from '@/registries';
import { useOverview, useSession, useSimulation } from '@/state';
import { NEW_PRODUCTION_HREF } from '@/ui/routes';
import { StartWritingButton } from '@/features/new-production/start-writing-button';
import { useNow } from '@/ui/time';
import { deskSummary } from './desk-copy';
import { InProgressPanel } from './in-progress-panel';
import { NeedsYouPanel } from './needs-you-panel';
import { FeaturedProduction } from './featured-production';
import { ProductionDesk } from './production-desk';
import { RecentActivity } from './recent-activity';
import { ReadyStory } from './ready-story';
import { parseRange, type OverviewRangeKey } from './overview-format';
import { WeekLine } from './week-line';

/**
 * An editorial desk: real story headlines and openings, continuation and delivery preview,
 * alongside the original personal/team queue. All actions use the existing R1 journey routes.
 * The read model, role-specific queues, live updates and URL window remain unchanged.
 */

type BodyProps = { range: OverviewRangeKey; onRangeChange: (range: OverviewRangeKey) => void };

/** Widgets of the current release (dashboard registry): later releases plug in by adding entries. */
const WIDGETS = new Set(dashboardWidgetsFor().map((widget) => widget.id));
const shows = (id: string) => WIDGETS.has(id);

const TITLE = 'Qual história vamos entregar hoje?';

function NewProductionButton() {
  return (
    <ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus}>
      Nova produção
    </ButtonLink>
  );
}

/** "Bom dia, Pedro. 2 peças esperam sua aprovação." once the desk, the viewer and the clock exist. */
function useSummary(data: OverviewData | undefined): string | undefined {
  const session = useSession();
  const now = useNow();
  if (!data || !now || session.status === 'loading') return undefined;
  return deskSummary({ hour: now.getHours(), name: session.data?.current?.name, groups: data.desk.groups });
}

function OverviewBody({ range, onRangeChange }: BodyProps) {
  const query = useOverview(range);
  const simulation = useSimulation();
  // Switching the window keeps the last answer on screen until the new one arrives (no skeleton flash).
  const [last, setLast] = useState<OverviewData | undefined>(undefined);
  if (query.status === 'ready' && query.data !== last) setLast(query.data);
  const data = query.status === 'ready' ? query.data : last;
  const summary = useSummary(data);
  // The week line names the window of the data on screen until the new window arrives.
  const shownRange = data?.range ?? range;
  const featured = shows('in-progress') ? data?.desk.continueWith : undefined;
  const ready = data?.desk.team.find((group) => group.stage === 'delivery')?.items[0];

  if (query.status === 'error' && data === undefined) {
    return (
      <PageStack>
        <PageHeader title={TITLE} actions={<><NewProductionButton /><StartWritingButton /></>} />
        <ErrorState size="panel" title="Não foi possível carregar o Início" description={query.error?.message} onRetry={query.retry} />
      </PageStack>
    );
  }

  if (data?.empty) {
    return (
      <PageStack>
        <PageHeader title={TITLE} />
        <EmptyState
          size="page"
          icon={Inbox}
          title="Nenhuma produção ainda"
          description="Crie uma produção com transcrição ou comece um artigo do zero."
          actions={
            <>
              <NewProductionButton />
              <StartWritingButton />
              {simulation.available && <Button onClick={simulation.reset}>Carregar exemplo</Button>}
            </>
          }
        />
      </PageStack>
    );
  }

  return (
    <PageStack>
      {/* A non-breaking space keeps the sentence's line while it loads (no jump under the title). */}
      <PageHeader
        title={TITLE}
        description={summary ?? ' '}
        actions={
          <>
            <NewProductionButton />
            <StartWritingButton />
            {shows('needs-you') && <ButtonLink href="#priorities">Ver prioridades</ButtonLink>}
          </>
        }
      />
      <SplitLayout
        asideLabel="Prioridades da sua produção"
        main={
          <>
            {shows('in-progress') && <FeaturedProduction item={featured} loading={!data} />}
            {shows('in-progress') && <InProgressPanel desk={data?.desk} featuredId={featured?.productionId} />}
            {shows('team') && <ProductionDesk desk={data?.desk} featuredId={featured?.productionId} />}
          </>
        }
        aside={
          shows('needs-you') && (
            <PageStack>
              {shows('team') && ready && <ReadyStory item={ready} />}
              <PageStack id="priorities" tabIndex={-1}>
                <NeedsYouPanel desk={data?.desk} team={shows('team')} featuredId={featured?.productionId} />
              </PageStack>
            </PageStack>
          )
        }
      />
      {shows('week') && data && <WeekLine week={data.desk.week} shownRange={shownRange} range={range} onRangeChange={onRangeChange} />}
      {shows('team') && <Accordion items={[{ id: 'activity', title: 'Ver movimentações recentes', content: <RecentActivity items={data?.activity} /> }]} />}
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
