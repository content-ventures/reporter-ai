'use client';

import { MetaList, Section, Segmented } from '@content-ventures/design-system/v3';
import type { DeskView } from '@/ports';
import { weekItems } from './desk-copy';
import { RANGE_OPTIONS, type OverviewRangeKey } from './overview-format';

/**
 * The week's numbers as one quiet line at the bottom (D1: the KPIs stop competing with the
 * queue): "Esta semana: 8 em produção · 14 aprovadas · 4,5 h até aprovar", with the 7 | 30 days
 * switch next to the numbers it changes.
 */
export function WeekLine({
  week,
  shownRange,
  range,
  onRangeChange,
}: {
  week: DeskView['week'];
  /** Window of the numbers on screen (they name it until the new window arrives). */
  shownRange: OverviewRangeKey;
  /** Window chosen in the switch. */
  range: OverviewRangeKey;
  onRangeChange: (range: OverviewRangeKey) => void;
}) {
  return (
    <Section
      meta={<MetaList size="sm" items={weekItems(week, shownRange)} />}
      action={<Segmented label="Período" size="sm" options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />}
    />
  );
}
