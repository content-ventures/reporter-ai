import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * "Visão geral" widgets (PLAN §3.1). The page lays out the widgets of the current release by
 * area; metrics read `OverviewView.metrics`. A widget that needs data only a real adapter
 * provides (cost, REQ-T.4) declares it and stays hidden while the runtime is simulated.
 */

export type DashboardArea = 'metrics' | 'main' | 'side' | 'full';

export type DashboardCapability = 'cost' | 'feedback';

export type DashboardWidget = {
  id: string;
  label: string;
  area: DashboardArea;
  icon: IconKey;
  since: ReleaseId;
  /** `OverviewView` field the widget renders. */
  source: string;
  /** For metrics: a falling value is good (time to approval). */
  lowerIsBetter?: boolean;
  /** Data the runtime must provide for the widget to show. */
  requires?: DashboardCapability;
  /** False while planned for a later milestone of the same release. */
  enabled: boolean;
};

export const DASHBOARD_WIDGETS: readonly DashboardWidget[] = [
  { id: 'in-production', label: 'Em produção', area: 'metrics', icon: 'Loader2', since: 'R1', source: 'metrics.inProduction', enabled: true },
  { id: 'awaiting-approval', label: 'Aguardando aprovação', area: 'metrics', icon: 'Inbox', since: 'R1', source: 'metrics.awaitingApproval', enabled: true },
  { id: 'approved', label: 'Aprovações', area: 'metrics', icon: 'CheckCircle2', since: 'R1', source: 'metrics.approved', enabled: true },
  {
    id: 'time-to-approval',
    label: 'Tempo até aprovação',
    area: 'metrics',
    icon: 'Clock',
    since: 'R1',
    source: 'metrics.timeToApprovalMs',
    lowerIsBetter: true,
    enabled: true,
  },
  { id: 'ai-retention', label: 'Aproveitamento da IA', area: 'metrics', icon: 'Gauge', since: 'R1', source: 'metrics.aiRetention', enabled: true },
  { id: 'generation-cost', label: 'Custo de geração', area: 'metrics', icon: 'BarChart3', since: 'R1', source: 'metrics.cost', requires: 'cost', enabled: true },
  { id: 'continue', label: 'Continue de onde parou', area: 'main', icon: 'PenLine', since: 'R1', source: 'continueWith', enabled: true },
  { id: 'awaiting-you', label: 'Aguardando você', area: 'side', icon: 'Inbox', since: 'R1', source: 'awaitingYou', enabled: true },
  { id: 'rhythm', label: 'Ritmo editorial', area: 'full', icon: 'ChartNoAxesColumn', since: 'R1', source: 'rhythm', enabled: true },
  { id: 'activity', label: 'Atividade', area: 'full', icon: 'Activity', since: 'R1', source: 'activity', enabled: true },
  // M5 brought into R1 (PO, 07/10): the live runs are the overview's immersion.
  { id: 'generating-now', label: 'Gerando agora', area: 'side', icon: 'Sparkles', since: 'R1', source: 'activeRuns', enabled: true },
  { id: 'news-queue', label: 'Fila de notícias', area: 'side', icon: 'Newspaper', since: 'R2', source: 'newsQueue', enabled: true },
  { id: 'channel-performance', label: 'Desempenho nos canais', area: 'full', icon: 'BarChart3', since: 'R6', source: 'performance', enabled: true },
];

export type DashboardRuntime = { capabilities: readonly DashboardCapability[] };

/** Widgets to render: released, enabled and backed by data the runtime provides. */
export function dashboardWidgetsFor(runtime: DashboardRuntime = { capabilities: [] }, release: ReleaseId = CURRENT_RELEASE): DashboardWidget[] {
  return availableIn(DASHBOARD_WIDGETS, release).filter(
    (widget) => widget.enabled && (widget.requires === undefined || runtime.capabilities.includes(widget.requires)),
  );
}
