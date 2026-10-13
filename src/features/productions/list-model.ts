import type { PieceStatus, ProductionStatus, Situation } from '@/domain';
import type { ListTab } from '@/ports';
import type { ListSort } from './list-params.ts';

/**
 * Pure rules of the "Produções" table (D12, COPY §9): which status tabs show, how a situation picks
 * its badge, and the sort the table and the "Ordenar" menu stand for. No React, so `node --test`
 * covers them.
 */

/** Statuses only a production has (a piece never is "Falta autorização", "Concluída" or "Arquivada"). */
const PRODUCTION_ONLY: ReadonlySet<string> = new Set<ProductionStatus>(['unauthorized', 'completed', 'archived']);

export type SituationStatusRef = { kind: 'piece'; status: PieceStatus } | { kind: 'production'; status: ProductionStatus };

function isProductionOnly(status: Situation['status']): status is ProductionStatus {
  return PRODUCTION_ONLY.has(status);
}

/** The badge behind a situation line: the piece's status, or the production's when only it has one. */
export function situationStatus(situation: Pick<Situation, 'status'>): SituationStatusRef {
  const status = situation.status;
  return isProductionOnly(status) ? { kind: 'production', status } : { kind: 'piece', status };
}

/**
 * Tabs worth showing: "Todas", the tab on screen, and every tab with something in it. While the
 * first counts load, only "Todas" and the tab on screen (nothing appears that may vanish).
 */
export function visibleTabs<T extends ListTab>(tabs: readonly T[], counts: Partial<Record<ListTab, number>> | undefined, active: ListTab): T[] {
  return tabs.filter((tab) => tab === 'all' || tab === active || (counts !== undefined && (counts[tab] ?? 0) > 0));
}

/** "Ordenar": the default puts what waits for someone first (COPY §9 "Mais urgentes"). */
export const SORT_LABELS: Readonly<Record<ListSort, string>> = {
  urgency: 'Mais urgentes',
  updated_desc: 'Mais recentes',
  updated_asc: 'Mais antigas',
};

/** The table's sorted column ("Atualizada") for a sort; none while the list is by urgency. */
export function tableSort(sort: ListSort): { key: 'updated'; direction: 'asc' | 'desc' } | undefined {
  if (sort === 'urgency') return undefined;
  return { key: 'updated', direction: sort === 'updated_asc' ? 'asc' : 'desc' };
}

/** A click on "Atualizada": newest first, then oldest first, then back to the most urgent. */
export function sortAfterHeaderClick(current: ListSort): ListSort {
  if (current === 'urgency') return 'updated_desc';
  if (current === 'updated_desc') return 'updated_asc';
  return 'urgency';
}
