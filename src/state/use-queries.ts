'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { FeedbackEntry } from '../domain/feedback.ts';
import type { PieceId, ProductionId, SourceId, VersionId } from '../domain/ids.ts';
import type { VersionRef } from '../domain/refs.ts';
import type { Page, PageRequest, PersonSummary } from '../ports/common.ts';
import type { FeedbackQuery } from '../ports/feedback.ts';
import type {
  ActivityItem,
  ActivityQuery,
  ApprovalsPage,
  ApprovalsTab,
  CompareView,
  DeliveryView,
  DraftView,
  OverviewData,
  OverviewRange,
  ProductionDetail,
  ProductionListFilter,
  ProductionListPage,
  ReviewView,
  SourceDetail,
  VersionDetail,
} from '../ports/production-queries.ts';
import {
  activityQuery,
  approvalsQuery,
  compareQuery,
  deliveryQuery,
  feedbackQuery,
  overviewQuery,
  peopleQuery,
  pieceQuery,
  productionQuery,
  productionsQuery,
  reviewQuery,
  sessionQuery,
  sourceQuery,
  versionQuery,
} from './query-specs.ts';
import type { RuntimeQuery, SessionData } from './query-specs.ts';
import { LOADING } from './query-state.ts';
import type { QueryError, QueryState } from './query-state.ts';
import type { Unsubscribe } from '../ports/common.ts';
import { useRuntimeHolderState } from './use-runtime.ts';

/**
 * Data hooks: `{ status: 'loading' | 'ready' | 'error', data, error, retry }`, refreshed
 * automatically when a change notice touches what they show. Ids may be `null`/`undefined`
 * while a screen does not know them yet (the hook then stays `loading`).
 */

type Missing = null | undefined;

const getLoading = () => LOADING;
const noop = () => {};
const noopUnsubscribe = () => noop;

/** Anything with a snapshot and change notifications (query and run cache entries). */
export type Watchable<T> = { snapshot(): QueryState<T>; subscribe(listener: () => void): Unsubscribe };

/** Subscribes a component to one cache entry (or to a fallback while there is none). */
export function useEntry<T>(entry: Watchable<T> | undefined, runtimeError: QueryError | undefined): QueryState<T> {
  const fallback = useMemo<QueryState<T>>(
    () => (runtimeError ? { status: 'error', data: undefined, error: runtimeError, retry: noop } : LOADING),
    [runtimeError],
  );
  const subscribe = useCallback((onChange: () => void) => (entry ? entry.subscribe(onChange) : noopUnsubscribe()), [entry]);
  const getSnapshot = useCallback(() => (entry ? entry.snapshot() : fallback), [entry, fallback]);
  return useSyncExternalStore(subscribe, getSnapshot, getLoading);
}

export function useQuery<T>(spec: RuntimeQuery<T> | null): QueryState<T> {
  const state = useRuntimeHolderState();
  const entry = state.status === 'ready' && spec ? state.queries.entry(spec) : undefined;
  return useEntry(entry, state.status === 'error' ? state.error : undefined);
}

const when = <I, T>(id: I | Missing, build: (id: I) => RuntimeQuery<T>): RuntimeQuery<T> | null =>
  id === null || id === undefined ? null : build(id);

/** Visão geral: metrics with deltas, "Continue de onde parou", "Aguardando você", activity. */
export function useOverview(range: OverviewRange = '7d'): QueryState<OverviewData> {
  return useQuery(overviewQuery(range));
}

/** Produções: one page of the list plus the counts per tab. */
export function useProductions(filter?: ProductionListFilter, page?: Partial<PageRequest>): QueryState<ProductionListPage> {
  return useQuery(productionsQuery(filter, page));
}

/** Production header, stepper, hub and button guards. */
export function useProduction(productionId: ProductionId | Missing): QueryState<ProductionDetail> {
  return useQuery(when(productionId, productionQuery));
}

/** The studio's working draft of a piece (pass `revision` back to `saveDraft`). */
export function usePiece(pieceId: PieceId | Missing): QueryState<DraftView> {
  return useQuery(when(pieceId, pieceQuery));
}

export function useVersion(versionId: VersionId | Missing): QueryState<VersionDetail> {
  return useQuery(when(versionId, versionQuery));
}

export function useCompare(pieceId: PieceId | Missing, fromVersionId: VersionId | Missing, toVersionId: VersionId | Missing): QueryState<CompareView> {
  const ready = pieceId && fromVersionId && toVersionId;
  return useQuery(ready ? compareQuery(pieceId, fromVersionId, toVersionId) : null);
}

export function useSource(sourceId: SourceId | Missing, version?: number): QueryState<SourceDetail> {
  return useQuery(when(sourceId, (id) => sourceQuery(id, version)));
}

/** Revisão: the version under review by default. */
export function useReview(pieceId: PieceId | Missing, versionId?: VersionId): QueryState<ReviewView> {
  return useQuery(when(pieceId, (id) => reviewQuery(id, versionId)));
}

/** Entrega: the latest approved package, or another `selection`. */
export function useDelivery(productionId: ProductionId | Missing, selection?: VersionRef[]): QueryState<DeliveryView> {
  return useQuery(when(productionId, (id) => deliveryQuery(id, selection)));
}

/**
 * "Aprovações" for the acting member: one tab's items plus the counts of every tab (the menu's
 * "Aprovações N" reads `counts.to_approve`). `null` stays loading (members who cannot approve).
 */
export function useApprovals(tab: ApprovalsTab | null): QueryState<ApprovalsPage> {
  return useQuery(when(tab, approvalsQuery));
}

/** Newest first; semantic events only. */
export function useActivity(query?: ActivityQuery): QueryState<Page<ActivityItem>> {
  return useQuery(activityQuery(query));
}

export function usePeople(): QueryState<PersonSummary[]> {
  return useQuery(peopleQuery());
}

export function useFeedback(query?: FeedbackQuery): QueryState<FeedbackEntry[]> {
  return useQuery(feedbackQuery(query));
}

/** Acting member, workspace and members ("Agir como" in simulated mode). */
export function useSession(): QueryState<SessionData> {
  return useQuery(sessionQuery());
}
