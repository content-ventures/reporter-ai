import { briefHash } from '../../../domain/production.ts';
import type { Brief } from '../../../domain/production.ts';
import type { Ref } from '../../../domain/refs.ts';
import type { RunFold } from '../../../domain/run-events.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import { DEFAULT_ARTICLE_SIZE, isArticleSize } from '../../../domain/sizing.ts';
import { contentHash } from '../../../domain/text/hash.ts';
import type { ProductionState, StoreState } from './state.ts';

/**
 * Snapshot migrations. Schema 1 sized articles by words (`brief.length`: short/medium/long);
 * schema 2 sizes them by lauda (`brief.size`, João 2026-10-08). Every old length becomes Padrão
 * (2 laudas): the old "Curta" (≈ 500 words) is already ≈ 1,5 lauda and the old sections (2–5) all
 * fit it. The hash of a brief changes with the field, so the brief refs of earlier runs that used
 * the brief as it still is get the new hash; otherwise the studio would read "A pauta mudou
 * depois deste texto" for a brief nobody touched.
 */

type LegacyBrief = Omit<Brief, 'size'> & { size?: unknown; length?: unknown };

/** `briefHash` as schema 1 computed it (the field was `length`). */
function legacyBriefHash(brief: LegacyBrief): string {
  return contentHash({ angle: brief.angle?.trim() || undefined, sections: brief.sections, length: brief.length });
}

function migrateBrief(brief: LegacyBrief): Brief {
  const next: Brief = { sections: brief.sections, size: isArticleSize(brief.size) ? brief.size : DEFAULT_ARTICLE_SIZE, revision: brief.revision };
  return brief.angle !== undefined ? { angle: brief.angle, ...next } : next;
}

function migrateRefs(inputs: Ref[], legacyHash: string, hash: string): Ref[] {
  let changed = false;
  const next = inputs.map((ref) => {
    if (ref.kind !== 'brief' || ref.hash !== legacyHash) return ref;
    changed = true;
    return { ...ref, hash };
  });
  return changed ? next : inputs;
}

function migrateRun(run: GenerationRun, legacyHash: string, hash: string): GenerationRun {
  const inputs = migrateRefs(run.inputs, legacyHash, hash);
  return inputs === run.inputs ? run : { ...run, inputs };
}

function migrateProduction(entry: ProductionState, folds: Record<string, RunFold>): ProductionState {
  const legacy = entry.production.brief as LegacyBrief;
  if (isArticleSize(legacy.size) && legacy.length === undefined) return entry;
  const brief = migrateBrief(legacy);
  const legacyHash = legacyBriefHash(legacy);
  const hash = briefHash(brief);
  for (const run of entry.runs) {
    const fold = folds[run.id];
    if (fold) folds[run.id] = { ...fold, run: migrateRun(fold.run, legacyHash, hash) };
  }
  return { ...entry, production: { ...entry.production, brief }, runs: entry.runs.map((run) => migrateRun(run, legacyHash, hash)) };
}

/** Schema 1 → 2: `brief.length` → `brief.size` ('standard'), brief refs of unchanged briefs rehashed. */
export function migrateV1(state: StoreState): StoreState {
  const runFolds = { ...state.runFolds };
  const productions = state.productions.map((entry) => migrateProduction(entry, runFolds));
  return { ...state, productions, runFolds };
}
