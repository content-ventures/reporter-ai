import type { IsoDateTime, PersonId, WorkspaceId } from './ids.ts';

/**
 * Usage indicators of the platform console. The database (or the demo) answers raw facts per
 * day, person, workspace and model; `buildUsageReport` turns them into the totals, the daily
 * series, the model and the people rankings, and the estimated cost, in one pure place.
 */

export type UsagePeriod = 7 | 30 | 90;

export const USAGE_PERIODS: readonly UsagePeriod[] = [7, 30, 90];

export const DEFAULT_USAGE_PERIOD: UsagePeriod = 30;

/**
 * Reference prices in US$ per million tokens (audio: per hour), as published on 2026-10-19.
 * The console says "estimado": providers bill caching, batch and long context differently.
 */
export const PRICES_AS_OF = '2026-10-19';

type TokenPrice = { input: number; output: number };

const TOKEN_PRICES: Readonly<Record<string, TokenPrice>> = {
  'gpt-oss-120b': { input: 0.15, output: 0.6 },
  'gpt-oss-20b': { input: 0.075, output: 0.3 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-6-astra': { input: 10, output: 50 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'gpt-image-1': { input: 5, output: 40 },
};

const AUDIO_PRICES_PER_HOUR: Readonly<Record<string, number>> = {
  'whisper-large-v3': 0.111,
  'whisper-large-v3-turbo': 0.04,
};

/** `openai/gpt-oss-120b` and `gpt-oss-120b` price the same. */
function modelKey(model: string): string {
  return model.trim().toLowerCase().replace(/^(openai|anthropic|groq)\//, '');
}

/** `null` when the model has no reference price (the cost column says "—"). */
export function tokenCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = TOKEN_PRICES[modelKey(model)];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function audioCostUsd(model: string, seconds: number): number | null {
  const price = AUDIO_PRICES_PER_HOUR[modelKey(model)];
  return price === undefined ? null : (seconds / 3600) * price;
}

/** Facts per UTC day (`YYYY-MM-DD`). `personId: null` when nobody in particular acted. */
type FactKey = { day: string; personId: PersonId | null; workspaceId: WorkspaceId };

export type GenerationFact = FactKey & {
  model: string;
  completed: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
};

export type CountFact = FactKey & { count: number };

export type AudioFact = FactKey & { model: string; seconds: number };

export type UsageFacts = {
  generations: GenerationFact[];
  productions: CountFact[];
  approvals: CountFact[];
  audio: AudioFact[];
  /** One row per person and day with a sign-in or a request. */
  activeDays: (FactKey & { personId: PersonId })[];
  /** Everything stored now (not per period). */
  storageBytes: number;
  /** Person filters exclude objects whose original owner was not recorded. */
  storageIncomplete?:boolean;
};

export type UsageTotals = {
  activePeople: number;
  productions: number;
  approvals: number;
  generations: number;
  failedGenerations: number;
  inputTokens: number;
  outputTokens: number;
  audioMinutes: number;
  /** Estimated; models without a reference price count zero and set `unpriced`. */
  costUsd: number;
  unpriced: boolean;
};

export type UsageDay = {
  day: string;
  productions: number;
  generations: number;
  tokens: number;
  costUsd: number;
  activePeople: number;
};

export type ModelUsage = {
  model: string;
  generations: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

export type PersonUsage = {
  personId: PersonId;
  productions: number;
  generations: number;
  tokens: number;
  costUsd: number;
  activeDays: number;
};

export type WorkspaceUsage = {
  workspaceId: WorkspaceId;
  activePeople: number;
  productions: number;
  generations: number;
  tokens: number;
  costUsd: number;
};

export type UsageReport = {
  period: UsagePeriod;
  /** First and last day of the period (inclusive). */
  from: string;
  to: string;
  totals: UsageTotals;
  /** The same totals for the period just before, for the deltas. */
  previous: UsageTotals;
  /** One entry per day of the period, zeros included. */
  days: UsageDay[];
  models: ModelUsage[];
  people: PersonUsage[];
  workspaces: WorkspaceUsage[];
  storageBytes: number;
  storageIncomplete?:boolean;
  pricesAsOf: string;
};

const DAY_MS = 86_400_000;

export function utcDay(at: IsoDateTime | Date): string {
  return (typeof at === 'string' ? new Date(at) : at).toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS));
}

/** Days `[from, to]` of a period ending today, and of the period before it. */
export function usageWindow(period: UsagePeriod, now: IsoDateTime): { from: string; to: string; previousFrom: string; previousTo: string } {
  const to = utcDay(now);
  const from = addDays(to, -(period - 1));
  return { from, to, previousFrom: addDays(from, -period), previousTo: addDays(from, -1) };
}

function emptyTotals(): UsageTotals {
  return { activePeople: 0, productions: 0, approvals: 0, generations: 0, failedGenerations: 0, inputTokens: 0, outputTokens: 0, audioMinutes: 0, costUsd: 0, unpriced: false };
}

const within = (from: string, to: string) => (fact: { day: string }) => fact.day >= from && fact.day <= to;

function totalsOf(facts: UsageFacts, from: string, to: string): UsageTotals {
  const inside = within(from, to);
  const totals = emptyTotals();
  const people = new Set<string>();
  for (const fact of facts.generations.filter(inside)) {
    totals.generations += fact.completed;
    totals.failedGenerations += fact.failed;
    totals.inputTokens += fact.inputTokens;
    totals.outputTokens += fact.outputTokens;
    const cost = tokenCostUsd(fact.model, fact.inputTokens, fact.outputTokens);
    if (cost === null) totals.unpriced ||= fact.inputTokens + fact.outputTokens > 0;
    else totals.costUsd += cost;
  }
  for (const fact of facts.audio.filter(inside)) {
    totals.audioMinutes += fact.seconds / 60;
    const cost = audioCostUsd(fact.model, fact.seconds);
    if (cost === null) totals.unpriced ||= fact.seconds > 0;
    else totals.costUsd += cost;
  }
  for (const fact of facts.productions.filter(inside)) totals.productions += fact.count;
  for (const fact of facts.approvals.filter(inside)) totals.approvals += fact.count;
  for (const fact of facts.activeDays.filter(inside)) people.add(fact.personId);
  totals.activePeople = people.size;
  return totals;
}

function costOf(fact: GenerationFact): number {
  return tokenCostUsd(fact.model, fact.inputTokens, fact.outputTokens) ?? 0;
}

function audioCostOf(fact: AudioFact): number {
  return audioCostUsd(fact.model, fact.seconds) ?? 0;
}

export function buildUsageReport(facts: UsageFacts, period: UsagePeriod, now: IsoDateTime): UsageReport {
  const window = usageWindow(period, now);
  const inside = within(window.from, window.to);

  const days = new Map<string, UsageDay & { people: Set<string> }>();
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) {
    days.set(day, { day, productions: 0, generations: 0, tokens: 0, costUsd: 0, activePeople: 0, people: new Set() });
  }
  const models = new Map<string, ModelUsage>();
  const people = new Map<string, PersonUsage & { days: Set<string> }>();
  const workspaces = new Map<string, WorkspaceUsage & { people: Set<string> }>();
  const person = (id: PersonId) => {
    let entry = people.get(id);
    if (!entry) people.set(id, (entry = { personId: id, productions: 0, generations: 0, tokens: 0, costUsd: 0, activeDays: 0, days: new Set() }));
    return entry;
  };
  const workspace = (id: WorkspaceId) => {
    let entry = workspaces.get(id);
    if (!entry) workspaces.set(id, (entry = { workspaceId: id, activePeople: 0, productions: 0, generations: 0, tokens: 0, costUsd: 0, people: new Set() }));
    return entry;
  };

  for (const fact of facts.generations.filter(inside)) {
    const tokens = fact.inputTokens + fact.outputTokens;
    const cost = costOf(fact);
    const day = days.get(fact.day);
    if (day) { day.generations += fact.completed; day.tokens += tokens; day.costUsd += cost; }
    const model = models.get(fact.model) ?? { model: fact.model, generations: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: tokenCostUsd(fact.model, 0, 0) };
    model.generations += fact.completed;
    model.failed += fact.failed;
    model.inputTokens += fact.inputTokens;
    model.outputTokens += fact.outputTokens;
    model.costUsd = tokenCostUsd(fact.model, model.inputTokens, model.outputTokens);
    models.set(fact.model, model);
    if (fact.personId) { const entry = person(fact.personId); entry.generations += fact.completed; entry.tokens += tokens; entry.costUsd += cost; }
    const space = workspace(fact.workspaceId);
    space.generations += fact.completed; space.tokens += tokens; space.costUsd += cost;
  }
  for (const fact of facts.audio.filter(inside)) {
    const cost = audioCostOf(fact);
    const day = days.get(fact.day);
    if (day) day.costUsd += cost;
    if (fact.personId) person(fact.personId).costUsd += cost;
    workspace(fact.workspaceId).costUsd += cost;
  }
  for (const fact of facts.productions.filter(inside)) {
    const day = days.get(fact.day);
    if (day) day.productions += fact.count;
    if (fact.personId) person(fact.personId).productions += fact.count;
    workspace(fact.workspaceId).productions += fact.count;
  }
  for (const fact of facts.activeDays.filter(inside)) {
    days.get(fact.day)?.people.add(fact.personId);
    person(fact.personId).days.add(fact.day);
    workspace(fact.workspaceId).people.add(fact.personId);
  }

  return {
    period,
    from: window.from,
    to: window.to,
    totals: totalsOf(facts, window.from, window.to),
    previous: totalsOf(facts, window.previousFrom, window.previousTo),
    days: [...days.values()].map(({ people: active, ...day }) => ({ ...day, activePeople: active.size })),
    models: [...models.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)),
    people: [...people.values()]
      .map(({ days: active, ...entry }) => ({ ...entry, activeDays: active.size }))
      .sort((a, b) => b.generations - a.generations || b.productions - a.productions || b.activeDays - a.activeDays),
    workspaces: [...workspaces.values()].map(({ people: active, ...entry }) => ({ ...entry, activePeople: active.size })),
    storageBytes: facts.storageBytes,
    ...(facts.storageIncomplete?{storageIncomplete:true}:{}),
    pricesAsOf: PRICES_AS_OF,
  };
}
