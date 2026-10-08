import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Início widgets ("Minha mesa", D1). The page shows, top to bottom, what needs the viewer
 * (`queue`, with the "Equipe" view of the same area), what is in progress (`progress`) and one
 * quiet week line (`footer`). Management charts are not a writer's desk: they wait for the
 * "Desempenho" page (`performance`, R6). A widget that needs data only a real adapter provides
 * (cost, REQ-T.4) declares it and stays hidden while the runtime is simulated.
 */

export type DashboardArea = 'queue' | 'progress' | 'footer' | 'performance';

export type DashboardCapability = 'cost' | 'feedback';

export type DashboardWidget = {
  id: string;
  label: string;
  area: DashboardArea;
  icon: IconKey;
  since: ReleaseId;
  /** `OverviewData` field the widget renders. */
  source: string;
  /** For metrics: a falling value is good (time to approval). */
  lowerIsBetter?: boolean;
  /** Data the runtime must provide for the widget to show. */
  requires?: DashboardCapability;
  /** False while planned for a later milestone of the same release. */
  enabled: boolean;
};

export const DASHBOARD_WIDGETS: readonly DashboardWidget[] = [
  { id: 'needs-you', label: 'Precisa de você', area: 'queue', icon: 'Inbox', since: 'R1', source: 'desk.groups', enabled: true },
  { id: 'team', label: 'Equipe', area: 'queue', icon: 'UsersRound', since: 'R1', source: 'desk.team', enabled: true },
  { id: 'in-progress', label: 'Em andamento', area: 'progress', icon: 'PenLine', since: 'R1', source: 'desk.inProgress', enabled: true },
  { id: 'week', label: 'Esta semana', area: 'footer', icon: 'Clock', since: 'R1', source: 'desk.week', enabled: true },
  { id: 'news-queue', label: 'Fila de notícias', area: 'queue', icon: 'Newspaper', since: 'R2', source: 'newsQueue', enabled: true },
  // "Desempenho" (R6): the editorial rhythm, the cost of generation and the channels leave the desk.
  { id: 'rhythm', label: 'Ritmo editorial', area: 'performance', icon: 'ChartNoAxesColumn', since: 'R6', source: 'rhythm', enabled: true },
  {
    id: 'time-to-approval',
    label: 'Tempo até aprovação',
    area: 'performance',
    icon: 'Clock',
    since: 'R6',
    source: 'metrics.timeToApprovalMs',
    lowerIsBetter: true,
    enabled: true,
  },
  { id: 'generation-cost', label: 'Custo de geração', area: 'performance', icon: 'BarChart3', since: 'R6', source: 'metrics.cost', requires: 'cost', enabled: true },
  { id: 'channel-performance', label: 'Desempenho nos canais', area: 'performance', icon: 'BarChart3', since: 'R6', source: 'performance', enabled: true },
];

export type DashboardRuntime = { capabilities: readonly DashboardCapability[] };

/** Widgets to render: released, enabled and backed by data the runtime provides. */
export function dashboardWidgetsFor(runtime: DashboardRuntime = { capabilities: [] }, release: ReleaseId = CURRENT_RELEASE): DashboardWidget[] {
  return availableIn(DASHBOARD_WIDGETS, release).filter(
    (widget) => widget.enabled && (widget.requires === undefined || runtime.capabilities.includes(widget.requires)),
  );
}
