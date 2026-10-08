'use client';

import { Suspense, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Grid,
  PageHeader,
  PageStack,
  Panel,
  Segmented,
} from '@content-ventures/design-system/v3';
import { LayoutDashboard, Plus } from '@content-ventures/design-system/v3/icons';
import type { OverviewData } from '@/ports';
import { dashboardWidgetsFor } from '@/registries';
import { useOverview, useSimulation } from '@/state';
import { NEW_PRODUCTION_HREF } from '@/ui/routes';
import { ActivityPanel } from './activity-panel';
import { AwaitingSection } from './awaiting-section';
import { ContinuePanel } from './continue-panel';
import { GeneratingSection } from './generating-section';
import { OverviewMetrics } from './overview-metrics';
import { parseRange, RANGE_OPTIONS, type OverviewRangeKey } from './overview-format';
import { RhythmChart } from './rhythm-chart';

/**
 * Visão geral (`/`, PLAN §3.1, references 4 and 1). Indicators of the window (7 or 30 days, in
 * the URL as `?range=30d`), what waits for the viewer with the generations running right now
 * under it, the production to continue beside them, then the editorial rhythm and the latest
 * activity. Everything the viewer acts on sits above the fold at 1280×720; on a phone the order is
 * indicators → Aguardando → Gerando → Continue. Everything is live: the page re-reads the runtime
 * when anything changes, so approving elsewhere moves the numbers and the flagship generation
 * progresses in "Gerando agora".
 */

type BodyProps = { range: OverviewRangeKey; onRangeChange: (range: OverviewRangeKey) => void };

/** Widgets of the current release (dashboard registry): later releases plug in by adding entries. */
const WIDGETS = new Set(dashboardWidgetsFor().map((widget) => widget.id));
const shows = (id: string) => WIDGETS.has(id);

function NewProductionButton() {
  return (
    <ButtonLink href={NEW_PRODUCTION_HREF} variant="primary" icon={Plus}>
      Nova produção
    </ButtonLink>
  );
}

function OverviewBody({ range, onRangeChange }: BodyProps) {
  const query = useOverview(range);
  const simulation = useSimulation();
  // Switching the window keeps the last answer on screen until the new one arrives (no skeleton flash).
  const [last, setLast] = useState<OverviewData | undefined>(undefined);
  if (query.status === 'ready' && query.data !== last) setLast(query.data);
  const data = query.status === 'ready' ? query.data : last;
  const loading = data === undefined;
  // Labels follow the data on screen ("nos 7 dias anteriores") until the new window arrives.
  const shownRange = data?.range ?? range;

  if (query.status === 'error' && data === undefined) {
    return (
      <PageStack>
        <PageHeader title="Visão geral" actions={<NewProductionButton />} />
        <ErrorState
          size="page"
          title="Não foi possível carregar a visão geral"
          description={query.error?.message}
          onRetry={query.retry}
        />
      </PageStack>
    );
  }

  if (data?.empty) {
    return (
      <PageStack>
        <PageHeader title="Visão geral" />
        <EmptyState
          size="page"
          icon={LayoutDashboard}
          title="Nenhuma produção ainda"
          actions={
            <>
              <NewProductionButton />
              {simulation.available && <Button onClick={simulation.reset}>Carregar exemplo</Button>}
            </>
          }
        />
      </PageStack>
    );
  }

  return (
    <PageStack>
      <PageHeader
        title="Visão geral"
        actions={
          <>
            <NewProductionButton />
            <Segmented label="Período dos indicadores" options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />
          </>
        }
      />
      <OverviewMetrics data={data} range={shownRange} loading={loading} />
      {/* What waits for the viewer comes first in reading order (and first on a phone), with the
          generations running anywhere under it; the production to continue beside them. */}
      <Grid columns="1:2">
        {(shows('awaiting-you') || shows('generating-now')) && (
          <Panel>
            {shows('awaiting-you') && <AwaitingSection items={data?.awaitingYou} loading={loading} />}
            {shows('generating-now') && <GeneratingSection data={data} loading={loading} />}
          </Panel>
        )}
        {shows('continue') && <ContinuePanel data={data} loading={loading} />}
      </Grid>
      {/* Same columns as above: the feeds on the left (activity), the production's numbers on the right. */}
      <Grid columns="1:2">
        {shows('activity') && <ActivityPanel items={data?.activity} loading={loading} />}
        <RhythmChart data={data} range={shownRange} loading={loading} />
      </Grid>
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
