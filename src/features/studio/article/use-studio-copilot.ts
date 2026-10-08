'use client';

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { sizeOf, type RunId, type Suggestion, type TextRange } from '@/domain';
import { blockEntries, blockTextOf, type Editor } from '@/editor';
import type { PieceView, ProductionDetail } from '@/ports';
import { copilotTool, type CopilotTool } from '@/registries';
import type { Commands } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';
import { clip, excerptLabel, type ViewerSegment } from './studio-model';
import { askQuestion, assistTurnsOf, selectionTarget, toolForSuggestion, unpinnedRunIds } from './studio-session-model';
import type { ComposerChip, SessionTurn, SuggestionFocus } from './studio-types';
import type { StudioText } from './use-studio-text';

type ToolOptions = { target?: TextRange[]; prompt?: string; chips?: ComposerChip[]; question?: string };

/** The whole block under the caret, when it has text ("Virar lista" with nothing selected). */
function caretBlockTarget(editor: Editor | null): TextRange[] | undefined {
  if (!editor || editor.isDestroyed) return undefined;
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return undefined;
  const node = $from.node(1);
  const entry = blockEntries(editor.state.doc).find((candidate) => candidate.node === node);
  if (!entry?.id) return undefined;
  const text = blockTextOf(node);
  return text.trim() ? [{ blockId: entry.id, from: 0, to: text.length }] : undefined;
}

let turnCounter = 0;
const nextTurnId = () => `turn-${(turnCounter += 1)}`;

/**
 * The copilot (PLAN §3.5 "Copiloto"): the thread of this tab plus assist runs restored after a
 * reload, the composer with its context chips (a selection, transcript excerpts, the review
 * note) and every request to the model, whether typed, a preset chip, an inline action of the
 * selection bar or "Gerar de novo". A request on a passage points the suggestion bar at its run.
 */
export function useStudioCopilot({
  commands,
  production,
  piece,
  text,
  suggestions,
  liveOpen,
  setSuggestionFocus,
  segments,
  focusComposer,
  copilotHidden,
}: {
  commands: Commands;
  production: ProductionDetail;
  piece: PieceView;
  text: StudioText;
  suggestions: Suggestion[];
  liveOpen: Suggestion[];
  setSuggestionFocus: Dispatch<SetStateAction<SuggestionFocus>>;
  segments: ViewerSegment[];
  focusComposer: () => void;
  copilotHidden: () => boolean;
}) {
  const pieceId = piece.id;
  const productionId = production.id;
  const { editor, prepare, currentSelection } = text;

  // ——— Thread ———
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [composer, setComposer] = useState('');
  const [chips, setChips] = useState<ComposerChip[]>([]);
  const updateTurn = useCallback((id: string, patch: Partial<SessionTurn>) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  /**
   * Persisted assist runs with open suggestions that this tab did not start (after a reload).
   * Once shown, a run stays in the thread after its suggestions are decided.
   */
  const [pinnedRuns, setPinnedRuns] = useState<readonly string[]>([]);
  const unpinned = unpinnedRunIds(liveOpen, pinnedRuns);
  if (unpinned.length > 0) setPinnedRuns([...pinnedRuns, ...unpinned]);
  const persistedTurns = useMemo<SessionTurn[]>(
    () => assistTurnsOf({ runs: production.runs, pieceId, pinned: pinnedRuns, turns, suggestions }),
    [turns, pinnedRuns, suggestions, production.runs, pieceId],
  );
  const thread = useMemo(() => [...persistedTurns, ...turns], [persistedTurns, turns]);
  const activeAssist = production.activeRuns.find((run) => run.pieceId === pieceId && run.kind !== 'article.generate');

  // ——— Requests ———
  const startTool = useCallback(
    async (tool: CopilotTool, options: ToolOptions = {}) => {
      const request = tool.request;
      if (!request) return;
      const needsTarget = tool.target === 'selection' || tool.target === 'block';
      const selection = currentSelection();
      const target = options.target ?? (needsTarget ? (selection.empty ? caretBlockTarget(editor) : selection.ranges) : undefined);
      const turn: SessionTurn = {
        id: nextTurnId(),
        prompt: options.prompt ?? tool.label,
        toolId: tool.id,
        chips: options.chips ?? [],
        at: Date.now(),
        ...(target ? { target } : {}),
        ...(options.question ? { question: options.question } : {}),
      };
      setTurns((current) => [...current, turn]);
      if (needsTarget && (!target || target.length === 0)) {
        updateTurn(turn.id, { reply: 'Selecione um trecho no texto e peça de novo.' });
        return;
      }
      const prepared = await prepare();
      if (!prepared) return;
      const base = { productionId, pieceId, baseRevision: prepared.baseRevision, body: prepared.body };
      const simulation = takeArmedSimulation(request);
      const startOptions = simulation ? { simulation } : undefined;
      let result;
      switch (request) {
        case 'article.rewrite':
          result = await commands.generation.start('article.rewrite', { ...base, target: target ?? [], tone: tool.tone ?? 'direct' }, startOptions);
          break;
        case 'article.shorten':
          result = await commands.generation.start(
            'article.shorten',
            target ? { ...base, target } : { ...base, ...(tool.toBriefSize ? { targetCharacters: sizeOf(production.brief.size).maxChars } : {}) },
            startOptions,
          );
          break;
        case 'article.expand-from-source':
          result = await commands.generation.start('article.expand-from-source', { ...base, target: target ?? [] }, startOptions);
          break;
        case 'article.to-list':
          result = await commands.generation.start('article.to-list', { ...base, target: target ?? [] }, startOptions);
          break;
        case 'article.titles':
          result = await commands.generation.start('article.titles', base, startOptions);
          break;
        case 'article.subheadings':
          result = await commands.generation.start('article.subheadings', base, startOptions);
          break;
        case 'article.ask':
          result = await commands.generation.start('article.ask', { ...base, prompt: options.question ?? options.prompt ?? tool.label, ...(target ? { target } : {}) }, startOptions);
          break;
        case 'article.apply-note':
          result = await commands.generation.start('article.apply-note', { ...base, note: options.question ?? '', anchors: target ?? [] }, startOptions);
          break;
        default:
          return;
      }
      if (!result.ok) {
        updateTurn(turn.id, { reply: result.refusal.message });
        return;
      }
      updateTurn(turn.id, { runId: result.value.runId });
      if (target && target.length > 0) setSuggestionFocus({ runId: result.value.runId, target });
    },
    [currentSelection, editor, prepare, productionId, pieceId, commands, updateTurn, production.brief.size, setSuggestionFocus],
  );

  /** "Gerar de novo": the same request again, on the passage as it is now. */
  const repeatTurn = useCallback(
    (turn: SessionTurn) => {
      const first = turn.runId ? suggestions.find((suggestion) => suggestion.runId === turn.runId) : undefined;
      const tool = turn.toolId ? copilotTool(turn.toolId) : first ? toolForSuggestion(first) : undefined;
      if (!tool) return;
      void startTool(tool, {
        prompt: turn.prompt,
        chips: turn.chips,
        ...(turn.target ? { target: turn.target } : {}),
        ...(turn.question ? { question: turn.question } : {}),
      });
    },
    [suggestions, startTool],
  );

  const runTool = useCallback(
    (toolId: string, options?: ToolOptions) => {
      const tool = copilotTool(toolId);
      if (tool) void startTool(tool, options);
    },
    [startTool],
  );

  const ask = useCallback(
    (typed: string) => {
      const tool = copilotTool('ask');
      if (!tool) return;
      const used = chips;
      const target = selectionTarget(used);
      setComposer('');
      setChips([]);
      void startTool(tool, { prompt: typed, question: askQuestion(typed, used), chips: used, ...(target ? { target } : {}) });
    },
    [chips, startTool],
  );

  /** A preset chip of the composer: the pinned selection is its target, then the chips clear. */
  const runPreset = useCallback(
    (toolId: string) => {
      const used = chips;
      const target = selectionTarget(used);
      setChips([]);
      runTool(toolId, { chips: used, ...(target ? { target } : {}) });
    },
    [chips, runTool],
  );

  // ——— Context chips ———
  const addChip = useCallback((chip: ComposerChip) => {
    setChips((current) => [...current.filter((entry) => entry.id !== chip.id), chip]);
  }, []);
  const removeChip = useCallback((id: string) => setChips((current) => current.filter((chip) => chip.id !== id)), []);

  const askAboutSelection = useCallback(() => {
    const selection = currentSelection();
    if (selection.empty) {
      focusComposer();
      return;
    }
    addChip({ id: `sel-${selection.from}-${selection.to}`, kind: 'selection', label: `Seleção · ${selection.label ?? ''}`.trim(), ranges: selection.ranges, text: selection.text });
    focusComposer();
  }, [currentSelection, addChip, focusComposer]);

  const addExcerpt = useCallback(
    (selected: { segmentId: string; text: string }, askNow = false) => {
      const segment = segments.find((entry) => entry.id === selected.segmentId);
      const label = excerptLabel(segment);
      addChip({ id: `exc-${selected.segmentId}-${selected.text.length}`, kind: 'excerpt', label, segmentId: selected.segmentId, text: clip(selected.text, 400) });
      if (askNow) focusComposer();
      else if (copilotHidden()) toast(`${label} no pedido ao Assistente`, { tone: 'info' });
    },
    [segments, addChip, focusComposer, copilotHidden],
  );

  // ——— Runs of the thread ———
  const stopAssist = useCallback(async () => {
    if (activeAssist) await commands.generation.cancel(activeAssist.id);
  }, [activeAssist, commands]);

  const retryRun = useCallback(
    async (runId: RunId) => {
      const result = await commands.generation.retry(runId);
      if (!result.ok) {
        toast('Não foi possível tentar de novo', { tone: 'error', description: result.refusal.message });
        return;
      }
      setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, runId: result.value.runId } : turn)));
    },
    [commands],
  );

  return {
    thread,
    activeAssist,
    composer,
    setComposer,
    chips,
    addChip,
    removeChip,
    startTool,
    repeatTurn,
    runTool,
    ask,
    runPreset,
    askAboutSelection,
    addExcerpt,
    stopAssist,
    retryRun,
  };
}
