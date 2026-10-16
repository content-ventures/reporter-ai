'use client';

import { Suspense, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ErrorState, PageHeader, PageStack, SplitLayout } from '@content-ventures/design-system/v3';
import type { DeskView, InProgressItem, OverviewData } from '@/ports';
import { dashboardWidgetsFor } from '@/registries';
import { useOverview, useSession } from '@/state';
import { NewProductionLink } from '@/features/new-production/new-production-link';
import { StartWritingButton } from '@/features/new-production/start-writing-button';
import { usePhone } from '@/ui/use-phone';
import { useNow } from '@/ui/time';
import { deskSummary, greeting } from './desk-copy';
import { ContinueCarousel } from './continue-carousel';
import { NeedsYouPanel } from './needs-you-panel';
import { RecentActivity } from './recent-activity';
import { RecentProductions } from './recent-productions';
import { parseRange, type OverviewRangeKey } from './overview-format';
import { StageFigures } from './stage-figures';
import { WeekPanel } from './week-panel';

/** Greet, show where the work stands, resume it and resolve the viewer’s pending actions. */

type BodyProps = { range: OverviewRangeKey; onRangeChange: (range: OverviewRangeKey) => void };

/** Widgets of the current release (dashboard registry): later releases plug in by adding entries. */
const WIDGETS = new Set(dashboardWidgetsFor().map((widget) => widget.id));
const shows = (id: string) => WIDGETS.has(id);

/** Most cards "Continuar de onde parou" offers. */
const CONTINUE_LIMIT = 8;

/** A non-breaking space keeps the header's lines while the clock, the viewer and the desk load. */
const BLANK = '\u00a0';

/** "Bom dia, João" over "1 peça voltou com ajustes." once the desk, the viewer and the clock exist. */
function useGreeting(data: OverviewData | undefined): { title: string; summary: string } {
  const session = useSession();
  const now = useNow();
  if (!now || session.status === 'loading') return { title: BLANK, summary: BLANK };
  return { title: greeting(now.getHours(), session.data?.current?.name), summary: data ? deskSummary(data.desk.groups) : BLANK };
}

/** Every production in progress, the viewer's next move first, then the latest activity. */
function continueItems(desk: DeskView): InProgressItem[] {
  const first = desk.continueWith?.productionId;
  return desk.team
    .flatMap((group) => group.items)
    .filter((item) => item.situation.status !== 'completed')
    .sort((a, b) => Number(b.productionId === first) - Number(a.productionId === first) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, CONTINUE_LIMIT);
}

const actions = (
  <>
    <NewProductionLink />
    <StartWritingButton />
  </>
);

function OverviewBody({ range, onRangeChange }: BodyProps) {
  const query = useOverview(range);
  const phone = usePhone();
  // Switching the window keeps the last answer on screen until the new one arrives (no skeleton flash).
  const [last, setLast] = useState<OverviewData | undefined>(undefined);
  if (query.status === 'ready' && query.data !== last) setLast(query.data);
  const data = query.status === 'ready' ? query.data : last;
  const header = useGreeting(data);

  if (query.status === 'error' && data === undefined) {
    return (
      <PageStack>
        <PageHeader title={header.title} actions={actions} />
        <ErrorState size="panel" title="Não foi possível carregar o Início" description={query.error?.message} onRetry={query.retry} />
      </PageStack>
    );
  }

  const figures = shows('team') && <StageFigures desk={data?.desk} />;
  const resume = shows('in-progress') && <ContinueCarousel items={data ? continueItems(data.desk) : undefined} />;
  const recent = shows('in-progress') && !data?.empty && <RecentProductions />;
  const pending = shows('needs-you') && <NeedsYouPanel desk={data?.desk} />;
  const week = shows('week') && <WeekPanel data={data} range={range} onRangeChange={onRangeChange} />;
  const activity = shows('team') && <RecentActivity items={data?.activity} />;

  return (
    <PageStack>
      <PageHeader title={header.title} description={header.summary} actions={actions} />
      {phone ? <PageStack>{pending}{figures}{resume}{recent}{week}{activity}</PageStack>
        : <SplitLayout main={<>{figures}{resume}{recent}</>} asideLabel="Sua mesa de trabalho" aside={<>{pending}{week}{activity}</>} />}
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
