import { ARTICLE_CHECKS, CAROUSEL_CHECKS } from '../domain/index.ts';
import type {
  ArticleCheckContext,
  CarouselCheckContext,
  CheckDefinition,
  CheckId,
  PieceKind,
  Source,
} from '../domain/index.ts';
import { availableIn, CURRENT_RELEASE, isReleased } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Check registry. `readiness` checks feed the studio status line, the review panel and the
 * "Prontidão" meter (only "Geração concluída" blocks approval). `generation` checks guard the
 * "Gerar" buttons: "Material autorizado" keeps "Gerar artigo" disabled with its reason (REQ-T.1).
 * The evaluators live in the domain; this registry decides which ones a release shows.
 */

export type CheckScope = 'generation' | 'readiness';

export type CheckEntry = {
  id: CheckId;
  label: string;
  pieceKind: PieceKind;
  scope: CheckScope;
  blocking: boolean;
  since: ReleaseId;
};

export type GenerationCheckContext = { sources: readonly Source[] };

export const GENERATION_CHECKS: readonly CheckDefinition<GenerationCheckContext>[] = [
  {
    id: 'source.authorized',
    label: 'Material autorizado',
    pieceKind: 'article',
    blocking: true,
    evaluate: ({ sources }) => {
      if (sources.length === 0) return { status: 'fail', detail: 'Adicione o material antes de gerar.' };
      const pending = sources.filter((source) => !source.rights.authorized).length;
      if (pending > 0) return { status: 'fail', detail: 'Confirme que o material está autorizado para gerar.' };
      return { status: 'pass' };
    },
  },
];

function entriesOf(definitions: readonly CheckDefinition<never>[], scope: CheckScope): CheckEntry[] {
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    pieceKind: definition.pieceKind,
    scope,
    blocking: definition.blocking,
    since: 'R1',
  }));
}

export const CHECKS: readonly CheckEntry[] = [
  ...entriesOf(GENERATION_CHECKS, 'generation'),
  ...entriesOf(ARTICLE_CHECKS, 'readiness'),
  ...entriesOf(CAROUSEL_CHECKS, 'readiness'),
  // Reserved: evidence flags (F2.8), writing guide (F2.5), SEO (R3), cut vs original (R4).
  { id: 'article.evidence', label: 'Evidências conferidas', pieceKind: 'article', scope: 'readiness', blocking: false, since: 'R2' },
  { id: 'article.style-guide', label: 'Guia de escrita', pieceKind: 'article', scope: 'readiness', blocking: false, since: 'R2' },
  { id: 'article.seo', label: 'SEO', pieceKind: 'article', scope: 'readiness', blocking: false, since: 'R3' },
  { id: 'cut.matches-original', label: 'Confere com o original', pieceKind: 'cut', scope: 'readiness', blocking: true, since: 'R4' },
];

export function checksFor(kind: PieceKind, scope: CheckScope, release: ReleaseId = CURRENT_RELEASE): CheckEntry[] {
  return availableIn(CHECKS, release).filter((entry) => entry.pieceKind === kind && entry.scope === scope);
}

function released<C>(definitions: readonly CheckDefinition<C>[], release: ReleaseId): CheckDefinition<C>[] {
  return definitions.filter((definition) => {
    const entry = CHECKS.find((candidate) => candidate.id === definition.id);
    return entry !== undefined && isReleased(entry.since, release);
  });
}

export function articleChecksFor(release: ReleaseId = CURRENT_RELEASE): CheckDefinition<ArticleCheckContext>[] {
  return released(ARTICLE_CHECKS, release);
}

export function carouselChecksFor(release: ReleaseId = CURRENT_RELEASE): CheckDefinition<CarouselCheckContext>[] {
  return released(CAROUSEL_CHECKS, release);
}

export function generationChecksFor(release: ReleaseId = CURRENT_RELEASE): CheckDefinition<GenerationCheckContext>[] {
  return released(GENERATION_CHECKS, release);
}
