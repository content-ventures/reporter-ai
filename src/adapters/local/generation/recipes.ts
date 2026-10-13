import type { PromptRef } from '../../../domain/run.ts';
import { contentHash } from '../../../domain/text/hash.ts';
import type { GenerationKind, SimulationScenario } from '../../../ports/generation.ts';
import { RUN_KIND_OF } from '../../../ports/generation.ts';
import { recipeFor } from '../../../registries/recipes.ts';

/**
 * Recipes are DATA owned by the registries (`src/registries/recipes.ts`): step ids, pt-BR labels
 * and the prompt key/version a run records. The simulation announces exactly those steps, so a
 * provider adapter that follows the same registry never changes AgentTrace or provenance.
 * The article recipe follows the editorial order (DECISION §Generation): material → structure →
 * sources and quotes → introduction → one child run per section → quote and size check; the
 * outline recipe ("Montar estrutura") stops after the structure.
 */

/** Step ids of the article recipe the executors rely on. */
export const DRAFT_STEPS = { read: 'read', select: 'select', outline: 'outline', intro: 'intro', check: 'quotes' } as const;

export type ConcreteStep = { id: string; label: string; child: boolean };

const CHILD_STEP_IDS = /^(intro|section-\d+)$/;

/** Concrete steps of a run (article sections expanded to `section-1…n`). */
export function recipeSteps(kind: GenerationKind, sections = 0): ConcreteStep[] {
  const runKind = RUN_KIND_OF[kind];
  return recipeFor(runKind)
    .steps({ sections })
    .map((step) => ({ id: step.id, label: step.label, child: runKind === 'article.generate' && CHILD_STEP_IDS.test(step.id) }));
}

/**
 * Prompt reference recorded on the run. Inline actions share the registry's `article.assist`
 * prompt; the action (and tone) is appended to the key so provenance says which one ran.
 */
export function promptRef(kind: GenerationKind, variant?: string): PromptRef {
  const base = recipeFor(RUN_KIND_OF[kind]).prompt;
  const action = kind.startsWith('article.') && RUN_KIND_OF[kind] === 'article.assist' ? kind.slice('article.'.length) : undefined;
  const key = [base.key, action, variant].filter(Boolean).join('.');
  return key === base.key ? base : { key, version: base.version, hash: contentHash({ key, version: base.version }) };
}

/** Prompt of a child run (one article section). */
export function sectionPromptRef(): PromptRef {
  return recipeFor('article.section').prompt;
}

const ASSIST_KINDS: GenerationKind[] = [
  'article.rewrite',
  'article.shorten',
  'article.expand-from-source',
  'article.to-list',
  'article.titles',
  'article.subheadings',
  'article.ask',
  'article.apply-note',
  'carousel.assist',
];

/** ⌘K "Simulação" group (visible only when the runtime runs simulated). */
export const LOCAL_SCENARIOS: readonly SimulationScenario[] = [
  { id: 'fail-section', label: 'Falhar ao escrever a seção 2', kinds: ['article.draft'] },
  { id: 'fail-read', label: 'Falhar ao ler o material', kinds: ['article.outline', 'article.draft'] },
  { id: 'fail-outline', label: 'Falhar ao montar a estrutura', kinds: ['article.outline'] },
  { id: 'review-outline', label: 'Pausar para revisar a estrutura', kinds: ['article.draft'] },
  { id: 'fail-suggestion', label: 'Falhar na sugestão da IA', kinds: ASSIST_KINDS },
  { id: 'fail-slides', label: 'Falhar ao escrever os slides', kinds: ['carousel.copy'] },
  { id: 'slow', label: 'Geração lenta', kinds: ['article.outline', 'article.draft', 'carousel.copy', ...ASSIST_KINDS] },
];

/** Step where a scenario makes the run fail, if any. */
export function failingStep(scenario: string | undefined, steps: readonly ConcreteStep[]): string | undefined {
  const has = (id: string) => steps.some((step) => step.id === id);
  switch (scenario) {
    case 'fail-section': {
      const sections = steps.filter((step) => step.id.startsWith('section-'));
      return (sections[1] ?? sections[sections.length - 1])?.id;
    }
    case 'fail-read':
      return has('read') ? 'read' : undefined;
    case 'fail-outline':
      return has('outline') ? 'outline' : undefined;
    case 'fail-suggestion':
      return has('write') ? 'write' : undefined;
    case 'fail-slides':
      return has('slides') ? 'slides' : undefined;
    default:
      return undefined;
  }
}

export const SIMULATED_FAILURE = {
  code: 'simulated_failure',
  message: 'Falha simulada nesta etapa. Tente de novo a partir dela.',
  retryable: true,
} as const;
