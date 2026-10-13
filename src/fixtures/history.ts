import type { ApprovalPoint, IsoDateTime } from '../domain/index.ts';
import { randomBetween, randomInt, seededRandom } from './prng.ts';
import type { Random } from './prng.ts';
import { ago, dateOf, DAY_MS, HOUR_MS, MINUTE_MS } from './time.ts';

/**
 * Seeded 60-day summary history for "Visão geral" (critique #40): approvals per day with
 * time-to-approval and AI-retention samples, plus productions created per day. Summary records
 * only (no fake productions); real fixture records are added on top by `buildOverview`.
 * Trends are gentle and plausible: more approvals, faster approvals, more AI text kept.
 */

export type DaySummary = {
  /** Calendar day (YYYY-MM-DD, UTC). */
  date: string;
  created: number;
  approved: number;
  failedGenerations: number;
};

export type FixtureHistory = {
  approvals: ApprovalPoint[];
  days: DaySummary[];
};

export const HISTORY_DAYS = 60;
export const HISTORY_SEED = 20261007;

function isWeekend(instant: IsoDateTime): boolean {
  const day = new Date(instant).getUTCDay();
  return day === 0 || day === 6;
}

/** Linear interpolation from `older` (60 days ago) to `recent` (yesterday). */
function trend(older: number, recent: number, offset: number, days: number): number {
  const progress = 1 - (offset - 1) / Math.max(1, days - 1);
  return older + (recent - older) * progress;
}

function approvalsFor(random: Random, rate: number, weekend: boolean): number {
  if (weekend) return random() < 0.35 ? 1 : 0;
  return Math.max(0, Math.round(rate + (random() - 0.5) * 1.8));
}

export function seededHistory(now: IsoDateTime, options: { days?: number; seed?: number } = {}): FixtureHistory {
  const days = options.days ?? HISTORY_DAYS;
  const random = seededRandom(options.seed ?? HISTORY_SEED);
  const approvals: ApprovalPoint[] = [];
  const summaries: DaySummary[] = [];

  for (let offset = days; offset >= 1; offset -= 1) {
    const dayStart = ago(now, { days: offset });
    const weekend = isWeekend(dayStart);
    const approved = approvalsFor(random, trend(1.5, 2.6, offset, days), weekend);
    const medianHours = trend(6.2, 3.6, offset, days);
    const retention = trend(0.63, 0.78, offset, days);

    for (let index = 0; index < approved; index += 1) {
      const minutesIntoDay = randomInt(random, 8 * 60, 20 * 60);
      const approvedAt = new Date(Date.parse(dayStart) + minutesIntoDay * MINUTE_MS).toISOString();
      const lead = medianHours * HOUR_MS * randomBetween(random, 0.55, 1.6);
      approvals.push({
        productionId: `hist-${dateOf(approvedAt)}-${index + 1}`,
        approvedAt,
        timeToApprovalMs: Math.round(lead),
        aiRetention: Math.round(Math.min(0.95, Math.max(0.4, retention + randomBetween(random, -0.07, 0.07))) * 1000) / 1000,
      });
    }

    const created = weekend ? (random() < 0.3 ? 1 : 0) : approved + (random() < 0.45 ? 1 : 0);
    summaries.push({
      date: dateOf(dayStart),
      created,
      approved,
      failedGenerations: random() < 0.08 ? 1 : 0,
    });
  }

  return { approvals: approvals.filter((point) => Date.parse(point.approvedAt) <= Date.parse(now) - 5 * MINUTE_MS), days: summaries };
}

/** Approvals inside the `days` window ending at `now` (for tests and sanity checks). */
export function approvalsInWindow(history: FixtureHistory, now: IsoDateTime, days: number, endOffsetDays = 0): ApprovalPoint[] {
  const end = Date.parse(now) - endOffsetDays * DAY_MS;
  return history.approvals.filter((point) => {
    const at = Date.parse(point.approvedAt);
    return at <= end && at > end - days * DAY_MS;
  });
}
