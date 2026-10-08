import type { GenerationRun, RunId, TextRange } from '../../../domain/index.ts';
import type { DraftView, PieceView, ProductionDetail, RunView, SourceDetail } from '../../../ports/index.ts';
import type { RunState } from '@/state';

/**
 * Shapes shared by the article studio hooks and its screens. `use-article-studio` re-exports
 * them, so the screens keep importing from there.
 */

export type ComposerChip =
  | { id: string; kind: 'selection'; label: string; ranges: TextRange[]; text: string }
  | { id: string; kind: 'excerpt'; label: string; segmentId: string; text: string }
  | { id: string; kind: 'note'; label: string; text: string };

/** A request made in this tab: the person's turn plus the run that answers it. */
export type SessionTurn = {
  id: string;
  runId?: RunId;
  /** What the person asked: the typed text or the action ("Mais direto"). */
  prompt: string;
  toolId?: string;
  target?: TextRange[];
  /** Text sent to the model when it differs from the prompt (context excerpts, the review note). */
  question?: string;
  chips: ComposerChip[];
  /** Immediate answer without a run (nothing selected, refused request). */
  reply?: string;
  at: number;
};

export type SourceTab = 'transcript' | 'structure' | 'versions';
export type CopilotTab = 'ai' | 'checks';

/**
 * Where the inline suggestion bar points: the run an inline action started, a chosen card, or the
 * passage the caret entered (`via: 'caret'`, which closes again when the caret leaves it).
 */
export type SuggestionFocus = { runId?: RunId; suggestionId?: string; target?: TextRange[]; via?: 'caret' } | null;

/** How a generation reaches the text: after what is there, or in place of it ("Gerar nova versão"). */
export type StreamMode = 'append' | 'replace';

export type GenerationState = {
  /** Generation run on screen (live, or the last one of this piece). */
  run: GenerationRun | RunView | undefined;
  runId: RunId | null;
  live: RunState | undefined;
  active: boolean;
  /** The run is known to this session, so "Tentar de novo a partir desta etapa" can reuse its steps. */
  retryable: boolean;
  /** Version this run produced ("v1 · IA"), once settled. */
  version?: PieceView['versions'][number];
};

export type StudioInputs = {
  production: ProductionDetail;
  piece: PieceView;
  draft: DraftView;
  source: SourceDetail | undefined;
  /** The material could not be read: the Fonte pane shows the error with "Tentar de novo". */
  sourceError?: { code?: string; retry: () => void };
};
