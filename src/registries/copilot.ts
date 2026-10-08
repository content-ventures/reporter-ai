import type { PieceKind, RunKind } from '../domain/index.ts';
import type { GenerationKind, RewriteTone } from '../ports/index.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Copilot tools (PLAN §3.5 "IA inline" and "Copiloto"). Each tool is data: where it appears,
 * what it targets and which run kind it starts. Presets are the chips above the PromptComposer.
 * Every result is labelled "Simulação local" by the provenance meta, never by the tool itself.
 */

export type CopilotTarget = 'selection' | 'block' | 'document' | 'slide';

export type CopilotGroup = 'rewrite' | 'length' | 'structure' | 'titles' | 'ask' | 'review';

export type CopilotTool = {
  id: string;
  label: string;
  group: CopilotGroup;
  pieceKind: PieceKind;
  target: CopilotTarget;
  runKind: RunKind;
  /** Generation request the tool starts (absent: not wired in the simulated adapter yet). */
  request?: GenerationKind;
  icon: IconKey;
  since: ReleaseId;
  /** Shown as a preset chip in the PromptComposer. */
  preset: boolean;
  tone?: RewriteTone;
  /** "Encurtar para 500 palavras": the whole text down to the brief's length target. */
  toBriefLength?: boolean;
  /** "Gerar títulos alternativos" proposes this many SuggestionCards. */
  proposals?: number;
  /** Shown only after a reviewer returned the piece with a note. */
  requiresReviewNote?: boolean;
};

export const COPILOT_TOOLS: readonly CopilotTool[] = [
  { id: 'rewrite.direct', label: 'Mais direto', group: 'rewrite', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.rewrite', icon: 'Sparkles', since: 'R1', preset: true, tone: 'direct' },
  { id: 'rewrite.didactic', label: 'Didático', group: 'rewrite', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.rewrite', icon: 'Sparkles', since: 'R1', preset: false, tone: 'didactic' },
  { id: 'rewrite.formal', label: 'Formal', group: 'rewrite', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.rewrite', icon: 'Sparkles', since: 'R1', preset: false, tone: 'formal' },
  { id: 'shorten', label: 'Encurtar', group: 'length', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.shorten', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'expand-with-source', label: 'Expandir com a fonte', group: 'length', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.expand-from-source', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'to-list', label: 'Virar lista', group: 'structure', pieceKind: 'article', target: 'block', runKind: 'article.assist', request: 'article.to-list', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'suggest-subheadings', label: 'Sugerir intertítulos', group: 'structure', pieceKind: 'article', target: 'document', runKind: 'article.assist', request: 'article.subheadings', icon: 'Sparkles', since: 'R1', preset: true },
  { id: 'shorten-to-brief', label: 'Encurtar até a extensão da pauta', group: 'length', pieceKind: 'article', target: 'document', runKind: 'article.assist', request: 'article.shorten', icon: 'Sparkles', since: 'R1', preset: true, toBriefLength: true },
  { id: 'titles', label: 'Gerar títulos alternativos', group: 'titles', pieceKind: 'article', target: 'document', runKind: 'article.titles', request: 'article.titles', icon: 'Sparkles', since: 'R1', preset: true, proposals: 3 },
  { id: 'ask', label: 'Perguntar à IA', group: 'ask', pieceKind: 'article', target: 'selection', runKind: 'article.assist', request: 'article.ask', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'apply-review-note', label: 'Aplicar nota com IA', group: 'review', pieceKind: 'article', target: 'document', runKind: 'article.assist', request: 'article.apply-note', icon: 'Sparkles', since: 'R1', preset: false, requiresReviewNote: true },
  { id: 'slide.rewrite', label: 'Reescrever', group: 'rewrite', pieceKind: 'carousel', target: 'slide', runKind: 'carousel.assist', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'slide.fit', label: 'Encurtar para caber', group: 'length', pieceKind: 'carousel', target: 'slide', runKind: 'carousel.assist', icon: 'Sparkles', since: 'R1', preset: false },
  { id: 'slide.swap-point', label: 'Trocar ponto', group: 'structure', pieceKind: 'carousel', target: 'slide', runKind: 'carousel.assist', icon: 'Sparkles', since: 'R1', preset: false },
  // Reserved: link suggestions (F2.13), evidence check (F2.8), SEO rewrite (R3).
  { id: 'suggest-links', label: 'Sugerir links do acervo', group: 'structure', pieceKind: 'article', target: 'document', runKind: 'article.assist', icon: 'Sparkles', since: 'R2', preset: false },
  { id: 'check-evidence', label: 'Conferir evidências', group: 'review', pieceKind: 'article', target: 'document', runKind: 'article.assist', icon: 'Sparkles', since: 'R2', preset: false },
  { id: 'seo-rewrite', label: 'Ajustar para SEO', group: 'rewrite', pieceKind: 'article', target: 'document', runKind: 'article.assist', icon: 'Sparkles', since: 'R3', preset: false },
];

export function copilotToolsFor(kind: PieceKind, release: ReleaseId = CURRENT_RELEASE): CopilotTool[] {
  return availableIn(COPILOT_TOOLS, release).filter((tool) => tool.pieceKind === kind);
}

/** Preset chips for the PromptComposer, in registry order. */
export function copilotPresets(kind: PieceKind = 'article', release: ReleaseId = CURRENT_RELEASE): CopilotTool[] {
  return copilotToolsFor(kind, release).filter((tool) => tool.preset);
}

export function copilotTool(id: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((tool) => tool.id === id);
}
