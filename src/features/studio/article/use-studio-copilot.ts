'use client';

import { useCallback, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { briefMaxChars, refKey, segmentRef, type RunId, type Suggestion, type TextRange } from '@/domain';
import { blockEntries, blockTextOf, type Editor } from '@/editor';
import type { PieceView, ProductionDetail, SourceDetail } from '@/ports';
import { copilotTool, type CopilotTool } from '@/registries';
import type { Commands } from '@/state';
import { takeArmedSimulation } from '@/ui/shell';
import { clip, excerptLabel, type ViewerSegment } from './studio-model';
import { askQuestion, assistTurnsOf, selectionTarget, toolForSuggestion, unpinnedRunIds } from './studio-session-model';
import type { ComposerChip, SessionTurn, SuggestionFocus } from './studio-types';
import type { StudioText } from './use-studio-text';
import { notifyRefusal } from '@/ui/permission-dialog';

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
  source,
  focusComposer,
  showAssistant,
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
  source: SourceDetail | undefined;
  focusComposer: () => void;
  showAssistant: () => void;
  copilotHidden: () => boolean;
}) {
  const pieceId = piece.id;
  const productionId = production.id;
  const { editor, prepare, currentSelection } = text;

  // ——— Thread ———
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [composer, setComposer] = useState('');
  const [chips, setChips] = useState<ComposerChip[]>([]);
  const sending = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const updateTurn = useCallback((id: string, patch: Partial<SessionTurn>) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)));
  }, []);

  /**
   * Persisted assist runs with open suggestions that this tab did not start (after a reload).
   * Once shown, a run stays in the thread after its suggestions are decided.
   */
  const [pinnedRuns, setPinnedRuns] = useState<readonly string[]>([]);
  const restored = production.runs.filter(run => run.pieceId === pieceId && run.model.engine === 'provider'
    && ['article.assist', 'article.titles'].includes(run.kind)).slice(-20).map(run => run.id);
  const unpinned = [...new Set([...unpinnedRunIds(liveOpen, pinnedRuns), ...restored.filter(id => !pinnedRuns.includes(id))])];
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
      if (!request || sending.current || activeAssist) return;
      showAssistant();
      const needsTarget = request !== 'article.ask' && (tool.target === 'selection' || tool.target === 'block');
      const selection = currentSelection();
      const target = options.target ?? (needsTarget ? (selection.empty ? caretBlockTarget(editor) : selection.ranges) : undefined);
      const turn: SessionTurn = {
        id: nextTurnId(),
        prompt: options.prompt ?? tool.label,
        toolId: tool.id,
        chips: options.chips ?? [],
        at: Date.now(),
        pending: true,
        ...(target ? { target } : {}),
        ...(options.question ? { question: options.question } : {}),
      };
      setTurns((current) => [...current, turn]);
      if (needsTarget && (!target || target.length === 0)) {
        updateTurn(turn.id, { reply: 'Selecione um trecho no texto e peça de novo.', pending: false });
        return;
      }
      sending.current = true;
      setSubmitting(true);
      try {
      const prepared = await prepare();
      if (!prepared) { updateTurn(turn.id, { pending: false, error: 'Não foi possível salvar o texto antes do ajuste. Tente novamente.' }); return; }
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
            target ? { ...base, target } : { ...base, ...(tool.toBriefSize ? { targetCharacters: briefMaxChars(production.brief) } : {}) },
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
        updateTurn(turn.id, { pending: false, error: result.refusal.message });
        return;
      }
      updateTurn(turn.id, { runId: result.value.runId, pending: false });
      if (target && target.length > 0) setSuggestionFocus({ runId: result.value.runId, target });
      } catch {
        updateTurn(turn.id, { pending: false, error: 'Não foi possível enviar o pedido. Seu texto está preservado; tente novamente.' });
      } finally { sending.current = false; setSubmitting(false); }
    },
    [currentSelection, editor, prepare, productionId, pieceId, commands, updateTurn, production.brief, setSuggestionFocus, activeAssist, showAssistant],
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
      if (!typed.trim() || sending.current || activeAssist) return;
      const tool = copilotTool('ask');
      if (!tool) return;
      const used = chips;
      const target = selectionTarget(used);
      setComposer('');
      setChips([]);
      void startTool(tool, { prompt: typed, question: askQuestion(typed, used), chips: used, ...(target ? { target } : {}) });
    },
    [chips, startTool, activeAssist],
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
    (selected: { segmentId: string; text: string; start?: number; end?: number }, askNow = false) => {
      if (!source) return;
      const segment = segments.find((entry) => entry.id === selected.segmentId);
      const ref = segmentRef(source.source.id, source.version.number, selected.segmentId, selected.start !== undefined && selected.end !== undefined ? { from: selected.start, to: selected.end } : undefined);
      const label = `${excerptLabel(segment)} · ${source.source.title} · v${source.version.number}`;
      addChip({ id: `exc-${refKey(ref)}-${selected.text.length}`, kind: 'excerpt', ref, label, segmentId: selected.segmentId, text: clip(selected.text, 400) });
      if (askNow) focusComposer();
      else if (copilotHidden()) toast(`${label} no pedido ao Assistente`, { tone: 'info' });
    },
    [source, segments, addChip, focusComposer, copilotHidden],
  );

  // ——— Runs of the thread ———
  const retryRun = useCallback(
    async (runId: RunId) => {
      try {
      const result = await commands.generation.retry(runId);
      if (!result.ok) {
        notifyRefusal('Não foi possível tentar de novo', result.refusal);
        return;
      }
      setTurns((current) => current.map((turn) => (turn.runId === runId ? { ...turn, runId: result.value.runId } : turn)));
      } catch { toast('Não foi possível tentar de novo', { tone: 'error', description: 'Confira a conexão. O texto original foi preservado.' }); }
    },
    [commands],
  );

  return {
    thread,
    activeAssist,
    submitting,
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
    retryRun,
  };
}
