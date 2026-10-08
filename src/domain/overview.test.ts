import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ProductionId } from './ids.ts';
import { buildOverview, DAY_MS, type ApprovalPoint } from './overview.ts';

const NOW = '2026-10-07T18:00:00.000Z';
const HOUR = 3_600_000;

/** One approval `daysAgo` days before NOW (half a day into that day). */
function approval(id: string, daysAgo: number, hours: number, retention: number): ApprovalPoint {
  return {
    productionId: id as ProductionId,
    approvedAt: new Date(Date.parse(NOW) - (daysAgo + 0.5) * DAY_MS).toISOString(),
    timeToApprovalMs: hours * HOUR,
    aiRetention: retention,
  };
}

describe('OverviewView trends (KPI sparklines)', () => {
  test('each metric over a trailing window per day of the window, ending at the metric now', () => {
    // Two approvals 10 and 9 days ago, one 3 days ago and one today.
    const history = [approval('a', 10, 8, 0.6), approval('b', 9, 6, 0.7), approval('c', 3, 4, 0.8), approval('d', 0, 2, 0.9)];
    const view = buildOverview({ records: [], history, now: NOW, rangeDays: 7 });

    assert.equal(view.trends.approved.length, 7);
    // Oldest day first: the week ending 6 days ago holds a and b; the one ending 3 days ago, b and c;
    // the one ending now, c and d.
    assert.deepEqual(view.trends.approved, [2, 2, 2, 2, 1, 1, 2]);
    assert.equal(view.trends.approved.at(-1), view.metrics.approved.value);
    assert.equal(view.trends.timeToApprovalMs.at(-1), view.metrics.timeToApprovalMs.value);
    assert.equal(view.trends.aiRetention.at(-1), view.metrics.aiRetention.value);
    assert.equal(view.trends.timeToApprovalMs[0], 7 * HOUR, 'median of 8 h and 6 h');
  });

  test('a trailing window with no approval is null for the median and the average, 0 for the count', () => {
    const view = buildOverview({ records: [], history: [approval('a', 0, 3, 0.75)], now: NOW, rangeDays: 7 });
    assert.deepEqual(view.trends.approved, [0, 0, 0, 0, 0, 0, 1]);
    assert.deepEqual(view.trends.timeToApprovalMs, [null, null, null, null, null, null, 3 * HOUR]);
    assert.deepEqual(view.trends.aiRetention, [null, null, null, null, null, null, 0.75]);
  });

  test('the 30-day window has one point per day', () => {
    const view = buildOverview({ records: [], history: [approval('a', 40, 3, 0.75)], now: NOW, rangeDays: 30 });
    assert.equal(view.trends.approved.length, 30);
    assert.equal(view.trends.approved[0], 1, 'the window ending 29 days ago reaches back 59 days');
    assert.equal(view.trends.approved.at(-1), 0);
  });
});
