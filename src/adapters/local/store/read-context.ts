import type { AssetLookup } from '../../../domain/asset.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import type { GateDefinition } from '../../../domain/decision.ts';
import type { IsoDateTime } from '../../../domain/ids.ts';
import type { FormatSupport } from '../../../domain/manifest.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import type { CommandContext } from '../../../domain/result.ts';
import type { FlowDefinition } from '../../../domain/stage.ts';
import { buildProductionView } from '../../../domain/views.ts';
import type { ProductionView } from '../../../domain/views.ts';
import { charsAvailable } from '../generation/outlook.ts';
import { firstNameOf } from './people.ts';
import { assembleRecord } from './state.ts';
import type { ProductionState, StoreState } from './state.ts';

/** Registry data and time every read-model builder needs. */
export type ReadContext = {
  state: StoreState;
  now: IsoDateTime;
  templates: readonly CarouselTemplate[];
  flow: FlowDefinition;
  gates: readonly GateDefinition[];
  formatSupport: FormatSupport;
  assets: AssetLookup;
  /** Bumped by every image metadata change (cached views depend on it through the checks). */
  assetsRevision: number;
};

/** A throwaway context for asking pure rules "would this be allowed?" without side effects. */
export function probeContext(ctx: Pick<ReadContext, 'now' | 'state'>): CommandContext {
  let counter = 0;
  return { now: ctx.now, newId: (prefix) => `${prefix}-probe-${(counter += 1)}`, actorId: ctx.state.sessionPersonId };
}

/** `people`: the situation line names people ("Aguardando aprovação de Pedro"); a rename rebuilds it. */
type CachedView = { sources: ProductionRecord['sources']; people: StoreState['people']; assetsRevision: number; view: ProductionView };

/**
 * State is immutable, so a production view can be reused while the production object and its
 * sources are the same. Views with an active run are rebuilt (durations depend on `now`).
 */
const viewCache = new WeakMap<ProductionState, CachedView>();

export function recordOf(ctx: Pick<ReadContext, 'state'>, production: ProductionState): ProductionRecord {
  return assembleRecord(ctx.state, production);
}

/** Characters of the longest article the record's material supports ("Tamanho" tells a short material). */
export function materialCharsOf(record: ProductionRecord): number | undefined {
  return record.sources.length > 0 ? charsAvailable(record.sources) : undefined;
}

export function viewOf(ctx: ReadContext, production: ProductionState, record = recordOf(ctx, production)): ProductionView {
  const cached = viewCache.get(production);
  const sameSources =
    cached !== undefined &&
    cached.sources.length === record.sources.length &&
    cached.sources.every((source, index) => source === record.sources[index]);
  if (cached && sameSources && cached.people === ctx.state.people && cached.assetsRevision === ctx.assetsRevision && cached.view.activeRuns.length === 0) return cached.view;
  const materialChars = materialCharsOf(record);
  const view = buildProductionView(record, {
    now: ctx.now,
    templates: ctx.templates,
    flow: ctx.flow,
    assets: ctx.assets,
    nameOf: (id) => firstNameOf(ctx.state, id),
    ...(materialChars !== undefined ? { materialChars } : {}),
  });
  viewCache.set(production, { sources: record.sources, people: ctx.state.people, assetsRevision: ctx.assetsRevision, view });
  return view;
}
