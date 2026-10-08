import { NO_ASSETS } from '../../../domain/asset.ts';
import type { AssetLookup } from '../../../domain/asset.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import { R1_GATES } from '../../../domain/decision.ts';
import type { GateDefinition } from '../../../domain/decision.ts';
import { LOCAL_FORMAT_SUPPORT } from '../../../domain/manifest.ts';
import { canOpenProduction } from '../../../domain/production.ts';
import type { FormatSupport } from '../../../domain/manifest.ts';
import { R1_FLOW } from '../../../domain/stage.ts';
import type { FlowDefinition } from '../../../domain/stage.ts';
import type { ProductionQueries } from '../../../ports/production-queries.ts';
import type { LocalStore } from './local-store.ts';
import { currentMember, toPersonSummary } from './people.ts';
import type { ReadContext } from './read-context.ts';
import { findProduction } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';
import { deliveryView } from './views-delivery.ts';
import { listProductions, toDetail } from './views-list.ts';
import { activityPage, overviewData } from './views-overview.ts';
import { compareVersions, draftView, reviewView, sourceDetail, versionDetail } from './views-piece.ts';
import { approvalsPage } from './views-queue.ts';

/** Registry data the read side needs (registries agent provides the real lists). */
export type ReadOptions = {
  templates?: readonly CarouselTemplate[];
  flow?: FlowDefinition;
  gates?: readonly GateDefinition[];
  formatSupport?: FormatSupport;
  /** Image metadata (credit, rights) for the image checks, the diff and the package. */
  assets?: AssetLookup;
  /** Changes whenever image metadata changes, so cached views are rebuilt. */
  assetsRevision?: () => number;
  /**
   * Artificial latency before each read (the local adapter adds 150–300 ms on first load so
   * skeletons and errors exist from day one). Receives the operation name.
   */
  delay?: (operation: string) => Promise<void>;
};

/**
 * Port boundary: results are deep copies (as if they crossed the network), so screens can never
 * mutate the store by accident and the local adapter behaves like a remote one.
 */
export function detach<T>(value: T): T {
  return structuredClone(value);
}

const visibleCache = new WeakMap<StoreState, StoreState>();

/**
 * REQ-T.1 (B06): what the acting member may read. A production restricted to another team (and
 * its activity) stays out of every read — lists, overview, ⌘K, pieces; opening its link answers
 * `restricted`. Same state object while nothing is hidden, cached per state otherwise.
 */
export function visibleState(state: StoreState): StoreState {
  const cached = visibleCache.get(state);
  if (cached) return cached;
  const member = currentMember(state);
  const hidden = new Set(state.productions.filter((entry) => !canOpenProduction(entry.production, member)).map((entry) => entry.production.id));
  const visible =
    hidden.size === 0
      ? state
      : {
          ...state,
          productions: state.productions.filter((entry) => !hidden.has(entry.production.id)),
          activity: state.activity.filter((event) => !event.productionId || !hidden.has(event.productionId)),
        };
  visibleCache.set(state, visible);
  return visible;
}

/** "Esta produção é restrita à equipe dela. Peça acesso a João." */
export function restrictedMessage(state: StoreState, production: ProductionState): string {
  const owner = state.people.find((person) => person.id === production.production.ownerId)?.name;
  return `Esta produção é restrita à equipe dela.${owner ? ` Peça acesso a ${owner}.` : ''}`;
}

export function createReadContext(store: LocalStore, options: ReadOptions): () => ReadContext {
  return () => ({
    state: visibleState(store.state),
    now: store.clock.now(),
    templates: options.templates ?? [],
    flow: options.flow ?? R1_FLOW,
    gates: options.gates ?? R1_GATES,
    formatSupport: options.formatSupport ?? LOCAL_FORMAT_SUPPORT,
    assets: options.assets ?? NO_ASSETS,
    assetsRevision: options.assetsRevision?.() ?? 0,
  });
}

export function createLocalQueries(store: LocalStore, options: ReadOptions = {}): ProductionQueries {
  const read = createReadContext(store, options);
  async function run<T>(operation: string, build: (ctx: ReadContext) => T): Promise<T> {
    if (options.delay) await options.delay(operation);
    return detach(build(read()));
  }
  return {
    list: (filter, page) => run('list', (ctx) => listProductions(ctx, filter, page)),
    get: (productionId) =>
      run('get', (ctx) => {
        const production = findProduction(ctx.state, productionId);
        if (production) return { ok: true as const, value: toDetail(ctx, production) };
        // It exists but belongs to another team: say so (and who to ask), never "not found".
        const restricted = findProduction(store.state, productionId);
        return restricted
          ? { ok: false as const, refusal: { code: 'restricted' as const, message: restrictedMessage(store.state, restricted) } }
          : { ok: false as const, refusal: { code: 'not_found' as const, message: 'Não encontramos esta produção.' } };
      }),
    overview: (range) => run('overview', (ctx) => overviewData(ctx, range)),
    activity: (query) => run('activity', (ctx) => activityPage(ctx, query)),
    people: () => run('people', (ctx) => ctx.state.people.map(toPersonSummary)),
    draft: (pieceId) => run('draft', (ctx) => draftView(ctx, pieceId)),
    version: (versionId) => run('version', (ctx) => versionDetail(ctx, versionId)),
    compare: (pieceId, fromId, toId) => run('compare', (ctx) => compareVersions(ctx, pieceId, fromId, toId)),
    source: (sourceId, version) => run('source', (ctx) => sourceDetail(ctx, sourceId, version)),
    review: (pieceId, versionId) => run('review', (ctx) => reviewView(ctx, pieceId, versionId)),
    delivery: (productionId, query) => run('delivery', (ctx) => deliveryView(ctx, productionId, query)),
    approvals: (tab) => run('approvals', (ctx) => approvalsPage(ctx, tab)),
    subscribe: (listener) => store.subscribe(listener),
  };
}
