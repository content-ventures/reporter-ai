/** Local simulated generation ("Simulação local"): imported only by src/runtime and tests. */

export { createLocalGenerationService } from './local-generation.ts';
export type { AdoptRefusal, LocalGenerationDeps, LocalGenerationService } from './local-generation.ts';
export { applyRunUpdate, keepLiveRun, recoverOrphanRuns, settleRun } from './record-sync.ts';
export { LOCAL_SCENARIOS, recipeSteps } from './recipes.ts';
export { realtimeSleep } from './pacing.ts';
export type { Sleep } from './pacing.ts';
