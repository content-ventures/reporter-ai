import { AUDIT_RESULTS, AUDIT_TYPES } from '../../domain/audit.ts';
import type { AuditResult, AuditType } from '../../domain/audit.ts';
import type { AuditFilter } from '../../ports/audit.ts';
import { dayBoundary } from '../productions/list-params.ts';
import type { SearchParamsLike } from '../productions/list-params.ts';

/**
 * Logs state that lives in the URL (F1.7): period, person, type, result, search, order, page and
 * the open event. Pure functions only, so `node --test` covers parsing, defaults and the filter
 * handed to `useAudit`.
 *
 * URL: `?from=2026-10-01&to=2026-10-07&person=person-pedro&type=access&result=denied&q=aurora
 *       &sort=oldest&page=2&size=50&event=aud-s-0012`. Defaults are omitted (`/admin/audit`).
 */

export const AUDIT_PAGE_SIZES = [25, 50, 100] as const;
export const AUDIT_DEFAULT_PAGE_SIZE = 25;

export type AuditParams = {
  /** Calendar days `YYYY-MM-DD` (inclusive). */
  from: string | null;
  to: string | null;
  /** Person id, or `system`. */
  person: string | null;
  type: AuditType | null;
  result: AuditResult | null;
  /** Search as typed (trimmed only when it becomes a filter). */
  q: string;
  sort: 'newest' | 'oldest';
  page: number;
  size: number;
  /** Event open in the drawer. */
  event: string | null;
};

export const DEFAULT_AUDIT_PARAMS: AuditParams = Object.freeze({
  from: null,
  to: null,
  person: null,
  type: null,
  result: null,
  q: '',
  sort: 'newest',
  page: 1,
  size: AUDIT_DEFAULT_PAGE_SIZE,
  event: null,
});

export const AUDIT_PARAM_KEYS: ReadonlySet<string> = new Set(['from', 'to', 'person', 'type', 'result', 'q', 'sort', 'page', 'size', 'event']);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w.-]{1,64}$/;
const MAX_QUERY = 120;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

function validDay(value: string | null): string | null {
  if (!value || !DAY.test(value)) return null;
  return Number.isNaN(new Date(`${value}T12:00:00`).getTime()) ? null : value;
}

function positiveInt(value: string | null, fallback: number): number {
  if (!value || !/^\d{1,6}$/.test(value)) return fallback;
  const number = Number(value);
  return number >= 1 ? number : fallback;
}

function id(value: string | null): string | null {
  return value && ID.test(value) ? value : null;
}

/** Reads the Logs state from the URL; anything unknown or malformed falls back to the default. */
export function parseAuditParams(search: SearchParamsLike): AuditParams {
  let from = validDay(search.get('from'));
  let to = validDay(search.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  const size = positiveInt(search.get('size'), AUDIT_DEFAULT_PAGE_SIZE);
  const type = search.get('type');
  const result = search.get('result');
  return {
    from,
    to,
    person: id(search.get('person')),
    type: isOneOf(AUDIT_TYPES, type) ? type : null,
    result: isOneOf(AUDIT_RESULTS, result) ? result : null,
    q: (search.get('q') ?? '').slice(0, MAX_QUERY),
    sort: search.get('sort') === 'oldest' ? 'oldest' : 'newest',
    page: positiveInt(search.get('page'), 1),
    size: (AUDIT_PAGE_SIZES as readonly number[]).includes(size) ? size : AUDIT_DEFAULT_PAGE_SIZE,
    event: id(search.get('event')),
  };
}

/** Query string without the leading `?`; defaults are left out (stable key order). */
export function serializeAuditParams(params: AuditParams): string {
  const out = new URLSearchParams();
  if (params.from) out.set('from', params.from);
  if (params.to) out.set('to', params.to);
  if (params.person) out.set('person', params.person);
  if (params.type) out.set('type', params.type);
  if (params.result) out.set('result', params.result);
  if (params.q.trim()) out.set('q', params.q);
  if (params.sort !== 'newest') out.set('sort', params.sort);
  if (params.page > 1) out.set('page', String(params.page));
  if (params.size !== AUDIT_DEFAULT_PAGE_SIZE) out.set('size', String(params.size));
  if (params.event) out.set('event', params.event);
  return out.toString();
}

/**
 * Applies a change. Anything that changes WHICH events match (filters, search, order, page size)
 * goes back to page 1 unless the patch sets the page; opening or closing an event keeps it.
 */
export function patchAuditParams(params: AuditParams, patch: Partial<AuditParams>): AuditParams {
  const next: AuditParams = { ...params, ...patch };
  const reshapes = (Object.keys(patch) as (keyof AuditParams)[]).some((key) => key !== 'page' && key !== 'event' && patch[key] !== params[key]);
  if (reshapes && patch.page === undefined) next.page = 1;
  return next;
}

/** Filters of the band (Período, Pessoa, Tipo, Resultado), not the search. */
export function auditFilterCount(params: AuditParams): number {
  return [params.from || params.to, params.person, params.type, params.result].filter(Boolean).length;
}

export const CLEARED_AUDIT_FILTERS: Partial<AuditParams> = Object.freeze({ from: null, to: null, person: null, type: null, result: null });

/** What `useAudit` receives. Same params → equal object (stable query key). */
export function auditFilter(params: AuditParams): AuditFilter {
  const filter: AuditFilter = { sort: params.sort };
  if (params.from) filter.from = dayBoundary(params.from, 'start');
  if (params.to) filter.to = dayBoundary(params.to, 'end');
  if (params.person) filter.actorIds = [params.person];
  if (params.type) filter.types = [params.type];
  if (params.result) filter.results = [params.result];
  const search = params.q.trim();
  if (search) filter.search = search;
  return filter;
}
