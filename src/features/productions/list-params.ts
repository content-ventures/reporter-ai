import type { SourceOrigin } from '@/domain';
import type { ListTab, ProductionListFilter } from '@/ports';
import { localDay, periodLabel, shortDay } from '../../ui/days.ts';

// Calendar days are shared by every list with a period filter (Produções, Logs): they live in `ui`.
export { localDay, periodLabel, shortDay };

/**
 * "Produções" state that lives in the URL (PLAN §3.2, §4.6): tab, search, filters, sort and
 * page. Pure functions only (no React, no window), so `node --test` covers parsing, defaults
 * and the filter handed to `useProductions`.
 *
 * URL: `?status=in_review&q=lume&owner=p-clara&origin=interview&from=2026-10-01&to=2026-10-07
 *       &sort=updated_asc&page=2&size=25`. Defaults are omitted, so a clean list is `/productions`
 * (most urgent first: what waits for a person, then the latest activity).
 */

export const LIST_TABS = ['all', 'editing', 'in_review', 'changes_requested', 'approved', 'completed', 'archived'] as const satisfies readonly ListTab[];

export const LIST_ORIGINS = ['interview', 'podcast', 'event', 'talk', 'other'] as const satisfies readonly SourceOrigin[];

export const PAGE_SIZES = [10, 25, 50] as const;

export const LIST_DEFAULT_PAGE_SIZE = 10;

/** `urgency` ("Mais urgentes", the default) or the last activity, newest or oldest first. */
export type ListSort = 'urgency' | 'updated_desc' | 'updated_asc';

export const LIST_SORTS = ['urgency', 'updated_desc', 'updated_asc'] as const satisfies readonly ListSort[];

export type ListParams = {
  tab: ListTab;
  /** Search as typed (trimmed only when it becomes a filter). */
  q: string;
  page: number;
  size: number;
  /** Responsável (person id). */
  owner: string | null;
  origin: SourceOrigin | null;
  /** Período of the last activity, calendar days `YYYY-MM-DD` (inclusive). */
  from: string | null;
  to: string | null;
  sort: ListSort;
};

export const DEFAULT_LIST_PARAMS: ListParams = Object.freeze({
  tab: 'all',
  q: '',
  page: 1,
  size: LIST_DEFAULT_PAGE_SIZE,
  owner: null,
  origin: null,
  from: null,
  to: null,
  sort: 'urgency',
});

/** Anything with `get(name)`: `URLSearchParams` or Next's `ReadonlyURLSearchParams`. */
export type SearchParamsLike = { get(name: string): string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERSON_ID = /^[\w.-]{1,64}$/;
const MAX_QUERY = 120;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

function validDay(value: string | null): string | null {
  if (!value || !DAY.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function positiveInt(value: string | null, fallback: number): number {
  if (!value || !/^\d{1,6}$/.test(value)) return fallback;
  const number = Number(value);
  return number >= 1 ? number : fallback;
}

/** Reads the list state from the URL; anything unknown or malformed falls back to the default. */
export function parseListParams(search: SearchParamsLike): ListParams {
  const status = search.get('status');
  const size = positiveInt(search.get('size'), LIST_DEFAULT_PAGE_SIZE);
  const owner = search.get('owner');
  const origin = search.get('origin');
  const sort = search.get('sort');
  let from = validDay(search.get('from'));
  let to = validDay(search.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    tab: isOneOf(LIST_TABS, status) ? status : 'all',
    q: (search.get('q') ?? '').slice(0, MAX_QUERY),
    page: positiveInt(search.get('page'), 1),
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : LIST_DEFAULT_PAGE_SIZE,
    owner: owner && PERSON_ID.test(owner) ? owner : null,
    origin: isOneOf(LIST_ORIGINS, origin) ? origin : null,
    from,
    to,
    sort: isOneOf(LIST_SORTS, sort) ? sort : 'urgency',
  };
}

/** Query string without the leading `?`; defaults are left out (stable key order). */
export function serializeListParams(params: ListParams): string {
  const out = new URLSearchParams();
  if (params.tab !== 'all') out.set('status', params.tab);
  if (params.q.trim()) out.set('q', params.q);
  if (params.owner) out.set('owner', params.owner);
  if (params.origin) out.set('origin', params.origin);
  if (params.from) out.set('from', params.from);
  if (params.to) out.set('to', params.to);
  if (params.sort !== 'urgency') out.set('sort', params.sort);
  if (params.page > 1) out.set('page', String(params.page));
  if (params.size !== LIST_DEFAULT_PAGE_SIZE) out.set('size', String(params.size));
  return out.toString();
}

/**
 * Applies a change. Anything that changes WHICH productions match (tab, search, filters, sort,
 * page size) goes back to page 1 unless the patch sets the page itself.
 */
export function patchListParams(params: ListParams, patch: Partial<ListParams>): ListParams {
  const next: ListParams = { ...params, ...patch };
  const reshapes = (Object.keys(patch) as (keyof ListParams)[]).some((key) => key !== 'page' && patch[key] !== params[key]);
  if (reshapes && patch.page === undefined) next.page = 1;
  return next;
}

/** Filters of the band (Responsável, Origem, Período), not the tab or the search. */
export function activeFilterCount(params: ListParams): number {
  return [params.owner, params.origin, params.from || params.to].filter(Boolean).length;
}

export function hasSearch(params: ListParams): boolean {
  return params.q.trim().length > 0;
}

/** Start or end of a local calendar day as an ISO instant. */
export function dayBoundary(day: string, edge: 'start' | 'end'): string {
  return new Date(`${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`).toISOString();
}

/** What `useProductions` receives. Same params → equal object (stable query key). */
export function listFilter(params: ListParams): ProductionListFilter {
  const filter: ProductionListFilter = { tab: params.tab, sort: params.sort };
  const search = params.q.trim();
  if (search) filter.search = search;
  if (params.owner) filter.ownerIds = [params.owner];
  if (params.origin) filter.origins = [params.origin];
  if (params.from) filter.updatedFrom = dayBoundary(params.from, 'start');
  if (params.to) filter.updatedTo = dayBoundary(params.to, 'end');
  return filter;
}
