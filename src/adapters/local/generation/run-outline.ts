import type { ArticleSize } from '../../../domain/sizing.ts';
import { materialMeta } from './draft-plan.ts';
import type { RunApi } from './engine.ts';
import type { OutlinePayload } from './outline.ts';
import { DRAFT_STEPS } from './recipes.ts';
import { outlineStep, simpleStep } from './run-draft.ts';

/**
 * "Montar estrutura" alone (Nova produção, step 3): reads the material and announces the proposed
 * structure, then ends. Nothing is written: no version, and the piece keeps its state; the person
 * reviews the structure and starts the draft with it ("Redigir artigo").
 */

/** What an outline-only run proposes, computed before it starts (deterministic, like a draft). */
export type OutlinePlan = { origin: 'outline'; material: { segments: number; speakers: number }; outline: OutlinePayload };

export async function runOutline(input: { api: RunApi; plan: OutlinePlan; size: ArticleSize }): Promise<void> {
  const { api, plan } = input;
  const read = await simpleStep(api, DRAFT_STEPS.read, async () => ((await api.wait(api.pacing.step())) ? materialMeta(plan) : false));
  if (!read) return;
  if (!(await outlineStep(api, { outline: plan.outline, size: input.size, reviewOutline: false }))) return;
  api.complete();
}
