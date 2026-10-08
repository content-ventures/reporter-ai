import { contentHash } from '../domain/index.ts';
import type { PromptRef, RunKind, StepId } from '../domain/index.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Generation recipes as data (PLAN §3.5): the step list every adapter emits for a run kind and
 * the prompt key/version recorded on the run (REQ-1.2, REQ-T.4). The simulated adapter and a
 * future provider adapter announce the same steps, so AgentTrace and provenance never change.
 * Prompt versions are placeholders until the team's real prompts arrive ("a confirmar").
 */

export type RecipeStep = { id: StepId; label: string };

export type RecipeOptions = {
  /** Article sections after the introduction (brief.sections). */
  sections?: number;
};

export type GenerationRecipe = {
  kind: RunKind;
  label: string;
  since: ReleaseId;
  prompt: PromptRef;
  steps: (options?: RecipeOptions) => RecipeStep[];
};

export const SIMULATED_PROMPT_VERSION = '0.1-simulado';

function prompt(key: string): PromptRef {
  return { key, version: SIMULATED_PROMPT_VERSION, hash: contentHash({ key, version: SIMULATED_PROMPT_VERSION }) };
}

/** Step id of article section `index` (1-based): `section-1`, `section-2`… */
export function sectionStepId(index: number): StepId {
  return `section-${index}`;
}

export function sectionStepLabel(index: number, total: number): string {
  return `Seção ${index} de ${total}`;
}

function articleSteps(options: RecipeOptions = {}): RecipeStep[] {
  const total = options.sections ?? 3;
  const sections = Array.from({ length: total }, (_, offset) => ({
    id: sectionStepId(offset + 1),
    label: sectionStepLabel(offset + 1, total),
  }));
  return [
    { id: 'read', label: 'Lendo material' },
    { id: 'select', label: 'Selecionando falas-chave' },
    { id: 'outline', label: 'Montando estrutura' },
    { id: 'intro', label: 'Introdução' },
    ...sections,
    { id: 'quotes', label: 'Conferindo citações' },
  ];
}

export const RECIPES: readonly GenerationRecipe[] = [
  { kind: 'article.generate', label: 'Gerar artigo', since: 'R1', prompt: prompt('article.generate'), steps: articleSteps },
  {
    kind: 'article.section',
    label: 'Reescrever seção',
    since: 'R1',
    prompt: prompt('article.section'),
    steps: () => [
      { id: 'read', label: 'Lendo seção e material' },
      { id: 'write', label: 'Escrevendo seção' },
      { id: 'quotes', label: 'Conferindo citações' },
    ],
  },
  {
    kind: 'article.assist',
    label: 'Assistente de texto',
    since: 'R1',
    prompt: prompt('article.assist'),
    steps: () => [
      { id: 'read', label: 'Lendo trecho' },
      { id: 'write', label: 'Escrevendo proposta' },
    ],
  },
  {
    kind: 'article.titles',
    label: 'Títulos alternativos',
    since: 'R1',
    prompt: prompt('article.titles'),
    steps: () => [
      { id: 'read', label: 'Lendo artigo' },
      { id: 'write', label: 'Propondo títulos' },
    ],
  },
  {
    kind: 'carousel.generate',
    label: 'Gerar carrossel',
    since: 'R1',
    prompt: prompt('carousel.generate'),
    steps: () => [
      { id: 'read', label: 'Lendo versão aprovada' },
      { id: 'points', label: 'Escolhendo pontos' },
      { id: 'cover', label: 'Escrevendo capa' },
      { id: 'slides', label: 'Escrevendo slides' },
      { id: 'limits', label: 'Conferindo limites' },
    ],
  },
  {
    kind: 'carousel.assist',
    label: 'Assistente do carrossel',
    since: 'R1',
    prompt: prompt('carousel.assist'),
    steps: () => [
      { id: 'read', label: 'Lendo slide' },
      { id: 'write', label: 'Ajustando texto' },
    ],
  },
];

export function recipesFor(release: ReleaseId = CURRENT_RELEASE): GenerationRecipe[] {
  return availableIn(RECIPES, release);
}

export function recipeFor(kind: RunKind): GenerationRecipe {
  const recipe = RECIPES.find((candidate) => candidate.kind === kind);
  if (!recipe) throw new Error(`No recipe registered for ${kind}`);
  return recipe;
}
