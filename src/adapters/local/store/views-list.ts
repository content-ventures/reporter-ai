import { productionTab } from '../../../domain/rules/status.ts';
import { foldForMatch } from '../../../domain/text/normalize.ts';
import type { ProductionView } from '../../../domain/views.ts';
import { DEFAULT_PAGE_SIZE } from '../../../ports/common.ts';
import type { Page, PageRequest } from '../../../ports/common.ts';
import type {
  ListTab,
  LiveRunSummary,
  ProductionDetail,
  ProductionListFilter,
  ProductionListItem,
  ProductionListPage,
} from '../../../ports/production-queries.ts';
import { wordsAvailable } from '../generation/outlook.ts';
import { productionGuards } from './guards.ts';
import { participantsOf, personOf } from './people.ts';
import { recordOf, viewOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';
import type { ProductionState } from './state.ts';

/** "Produções": list items, filters, tab counts and pagination. */

const TABS: readonly ListTab[] = ['all', 'editing', 'in_review', 'changes_requested', 'approved', 'completed', 'archived'];

function liveRun(view: ProductionView): LiveRunSummary | undefined {
  const run = view.activeRuns[0];
  if (!run) return undefined;
  const summary: LiveRunSummary = { runId: run.id, label: run.label, progress: run.progress };
  const piece = view.pieces.find((entry) => entry.id === run.pieceId);
  if (piece) summary.pieceKind = piece.kind;
  if (run.current) {
    summary.step = run.current.label;
    if (run.current.meta) summary.meta = run.current.meta;
  }
  return summary;
}

function currentReadiness(view: ProductionView): ProductionListItem['readiness'] {
  const stage = view.stages.find((entry) => entry.id === view.currentStageId);
  const piece = view.pieces.find((entry) => entry.kind === stage?.pieceKind) ?? view.pieces[view.pieces.length - 1];
  return piece ? { ...piece.readiness, pieceKind: piece.kind } : undefined;
}

export function toListItem(ctx: ReadContext, production: ProductionState): ProductionListItem {
  const record = recordOf(ctx, production);
  const view = viewOf(ctx, production, record);
  const owner = personOf(ctx.state, view.ownerId) ?? { id: view.ownerId, name: 'Sistema', initials: 'S' };
  const item: ProductionListItem = {
    id: view.id,
    title: view.title,
    status: view.status,
    statusLabel: view.statusLabel,
    tab: productionTab(view.status),
    stages: view.stages,
    currentStageId: view.currentStageId,
    nextAction: view.nextAction,
    participants: participantsOf(ctx.state, record),
    owner,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    archived: view.status === 'archived',
  };
  const source = record.sources[0];
  if (source) {
    item.material = { sourceId: source.id, title: source.title, origin: source.origin, authorized: source.rights.authorized };
    if (source.recordedOn) item.material.recordedOn = source.recordedOn;
  }
  const readiness = currentReadiness(view);
  if (readiness) item.readiness = readiness;
  const run = liveRun(view);
  if (run) item.liveRun = run;
  return item;
}

export function toDetail(ctx: ReadContext, production: ProductionState): ProductionDetail {
  const record = recordOf(ctx, production);
  const view = viewOf(ctx, production, record);
  const detail: ProductionDetail = {
    ...view,
    owner: personOf(ctx.state, view.ownerId) ?? { id: view.ownerId, name: 'Sistema', initials: 'S' },
    participants: participantsOf(ctx.state, record),
    guards: productionGuards(ctx, record),
  };
  if (record.sources.length > 0) detail.wordsAvailable = wordsAvailable(record.sources);
  return detail;
}

function searchText(item: ProductionListItem): string {
  return foldForMatch(
    [item.title, item.material?.title ?? '', ...item.participants.flatMap((entry) => [entry.label, entry.person?.name ?? ''])].join(' '),
  );
}

function matchesFilters(item: ProductionListItem, filter: ProductionListFilter): boolean {
  if (filter.search?.trim()) {
    const haystack = searchText(item);
    const terms = foldForMatch(filter.search).split(' ').filter(Boolean);
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  if (filter.ownerIds && filter.ownerIds.length > 0 && !filter.ownerIds.includes(item.owner.id)) return false;
  if (filter.origins && filter.origins.length > 0 && (!item.material || !filter.origins.includes(item.material.origin))) return false;
  const updated = Date.parse(item.updatedAt);
  if (filter.updatedFrom && updated < Date.parse(filter.updatedFrom)) return false;
  if (filter.updatedTo && updated > Date.parse(filter.updatedTo)) return false;
  return true;
}

function inTab(item: ProductionListItem, tab: ListTab): boolean {
  if (tab === 'all') return !item.archived;
  return item.tab === tab;
}

function compare(sort: ProductionListFilter['sort']): (a: ProductionListItem, b: ProductionListItem) => number {
  const byId = (a: ProductionListItem, b: ProductionListItem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  switch (sort) {
    case 'updated_asc':
      return (a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt) || byId(a, b);
    case 'created_desc':
      return (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || byId(a, b);
    case 'title':
      return (a, b) => a.title.localeCompare(b.title, 'pt-BR') || byId(a, b);
    default:
      return (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || byId(a, b);
  }
}

export function paginate<T>(items: readonly T[], request: Partial<PageRequest> = {}): Page<T> {
  const size = Math.max(1, Math.floor(request.size ?? DEFAULT_PAGE_SIZE));
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(1, Math.floor(request.page ?? 1)), pageCount);
  return { items: items.slice((page - 1) * size, page * size), total: items.length, page, size, pageCount };
}

export function listProductions(ctx: ReadContext, filter: ProductionListFilter = {}, request: Partial<PageRequest> = {}): ProductionListPage {
  const filtered = ctx.state.productions.map((production) => toListItem(ctx, production)).filter((item) => matchesFilters(item, filter));
  const counts = Object.fromEntries(TABS.map((tab) => [tab, filtered.filter((item) => inTab(item, tab)).length])) as Record<ListTab, number>;
  const tab = filter.tab ?? 'all';
  const items = filtered.filter((item) => inTab(item, tab)).sort(compare(filter.sort));
  return { ...paginate(items, request), counts };
}
