'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import type { ArticleBody, Suggestion, TextRange } from '@/domain';
import {
  applySuggestionInEditor,
  blockTextOf,
  caretAfterSelection,
  findBlockEntry,
  locateSuggestionInDoc,
  setArticleDecorations,
  suggestionAtCaret,
  useStaleSuggestionIds,
  type Editor,
  type SuggestionDecoration,
} from '@/editor';
import type { DraftView, RunView } from '@/ports';
import type { CopilotTool } from '@/registries';
import type { Commands } from '@/state';
import { isOpenSuggestion, nextInOrder, suggestionMarks } from './studio-model';
import { focusedSuggestionOf, toolForSuggestion } from './studio-session-model';
import type { SuggestionFocus } from './studio-types';
import type { StudioText } from './use-studio-text';

/** Suggestions that sit in the text (a title proposal lives in the copilot only). */
function inText(suggestion: Suggestion): boolean {
  return suggestion.proposal.kind !== 'title' && suggestion.proposal.kind !== 'slide' && suggestion.target.length > 0;
}

/**
 * Suggestions of the draft in the text: the open ones (cards in the copilot, decorations in the
 * text), the one the bar near the text points at (an inline action's run, a chosen card, or the
 * passage the caret is in) and whether that bar was dismissed. Runs before the copilot, which
 * points the bar at its runs.
 */
export function useSuggestionBar({ draft, editor }: { draft: DraftView; editor: Editor | null }) {
  const suggestions = draft.suggestions;
  const liveOpen = useMemo(() => suggestions.filter(isOpenSuggestion), [suggestions]);
  const staleIds = useStaleSuggestionIds(editor, liveOpen);
  const staleKey = staleIds.join(' ');
  const stateOf = useCallback(
    (suggestion: Suggestion) => (suggestion.state === 'ready' && staleIds.includes(suggestion.id) ? 'stale' : suggestion.state),
    [staleIds],
  );
  const [suggestionFocus, setSuggestionFocus] = useState<SuggestionFocus>(null);
  /** The suggestion whose passage holds the caret (its bar opens; a click there never hides it). */
  const [caretSuggestionId, setCaretSuggestionId] = useState<string | null>(null);
  /** The bar near the text was dismissed (click outside) for the focused suggestion. */
  const [hiddenBar, setHiddenBar] = useState<{ focus: SuggestionFocus } | null>(null);
  const focusedSuggestion = useMemo(() => focusedSuggestionOf(suggestionFocus, liveOpen), [suggestionFocus, liveOpen]);
  const caretInFocused = caretSuggestionId !== null && caretSuggestionId === focusedSuggestion?.id;
  const suggestionBarHidden = hiddenBar !== null && hiddenBar.focus === suggestionFocus && !caretInFocused;
  const hideSuggestionBar = useCallback(() => setHiddenBar({ focus: suggestionFocus }), [suggestionFocus]);

  // In the paragraph: the words a suggestion takes out are struck through and what it puts in reads
  // right after them (DS insertion widget). A stale one strikes nothing; its proposal reads faded.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const stale = new Set(staleKey ? staleKey.split(' ') : []);
    const decorations: SuggestionDecoration[] = liveOpen.filter(inText).map((suggestion) => {
      const located = suggestion.state === 'stale' || stale.has(suggestion.id) ? undefined : locateSuggestionInDoc(editor.state.doc, suggestion);
      const marks = suggestionMarks(located, suggestion);
      return { id: suggestion.id, ranges: marks.removed, insertions: marks.inserted, ...(marks.stale ? { stale: true } : {}) };
    });
    setArticleDecorations(editor.view, { suggestions: decorations });
  }, [editor, liveOpen, staleKey]);

  // The caret entering a suggestion's passage opens its bar; leaving it closes a bar it opened.
  const followCaret = useEffectEvent(() => {
    if (!editor || editor.isDestroyed) return;
    const id = suggestionAtCaret(editor.state, liveOpen);
    setCaretSuggestionId(id);
    if (id) setSuggestionFocus((current) => (current?.suggestionId === id ? current : { suggestionId: id, via: 'caret' }));
    else setSuggestionFocus((current) => (current?.via === 'caret' ? null : current));
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const onSelection = () => followCaret();
    editor.on('selectionUpdate', onSelection);
    return () => {
      editor.off('selectionUpdate', onSelection);
    };
  }, [editor]);

  return {
    suggestions,
    liveOpen,
    stateOf,
    suggestionFocus,
    setSuggestionFocus,
    suggestionBarHidden,
    hideSuggestionBar,
    focusedSuggestion,
  };
}

export type SuggestionBar = ReturnType<typeof useSuggestionBar>;

/**
 * Deciding a suggestion: "Aceitar" (applied in the editor, one undo reverts it), "Descartar",
 * "Reaplicar" on the passage as it is now, a card or the status line bringing a suggestion to its
 * passage, and ⌘↵ / Esc for the suggestion under the caret (or the one whose bar is open). With
 * nothing to decide, ⌘↵ goes to the next open suggestion.
 */
export function useSuggestionActions({
  commands,
  text,
  bar,
  startTool,
  activeAssist,
  stopAssist,
}: {
  commands: Commands;
  text: StudioText;
  bar: SuggestionBar;
  startTool: (tool: CopilotTool, options?: { target?: TextRange[] }) => Promise<void>;
  activeAssist: RunView | undefined;
  stopAssist: () => Promise<void>;
}) {
  const { editor, prepare, sync, handle, title, setLocalTitle, awaitReload, revealBlock } = text;
  const { setSuggestionFocus, focusedSuggestion, suggestionBarHidden, suggestionFocus, stateOf, liveOpen } = bar;

  /**
   * A suggestion brought to its passage: the bar points at it and the passage rises to the upper
   * third. `caret` (status line, ⌘↵) also puts the caret at the end of the passage, so ⌘↵ / Esc
   * decide it next; a card keeps the focus where it is.
   */
  const revealSuggestion = useCallback(
    (suggestion: Suggestion, options: { caret?: boolean } = {}) => {
      setSuggestionFocus({ suggestionId: suggestion.id, target: suggestion.target });
      if (!editor || editor.isDestroyed) return;
      const ranges = (stateOf(suggestion) === 'stale' ? undefined : locateSuggestionInDoc(editor.state.doc, suggestion)) ?? suggestion.target;
      const first = ranges[0];
      if (!first) return;
      const caret = options.caret ? ranges[ranges.length - 1] : undefined;
      revealBlock(first.blockId, caret ? { caret } : {});
    },
    [editor, revealBlock, setSuggestionFocus, stateOf],
  );

  /** "N sugestões abertas" and ⌘↵ with nothing to decide: the next open suggestion in reading order. */
  const nextSuggestion = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    const doc = editor.state.doc;
    const at = (suggestion: Suggestion): [number, number] => {
      const range = locateSuggestionInDoc(doc, suggestion)?.[0] ?? suggestion.target[0];
      const entry = range ? findBlockEntry(doc, range.blockId) : undefined;
      return [entry?.index ?? Number.MAX_SAFE_INTEGER, range?.from ?? 0];
    };
    const ordered = liveOpen
      .filter(inText)
      .map((suggestion) => ({ suggestion, order: at(suggestion) }))
      .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1])
      .map((entry) => entry.suggestion);
    const next = nextInOrder(ordered, focusedSuggestion ?? null, (a, b) => a.id === b.id);
    if (next) revealSuggestion(next, { caret: true });
  }, [editor, liveOpen, focusedSuggestion, revealSuggestion]);

  const accept = useCallback(
    async (suggestion: Suggestion) => {
      if (!editor || editor.isDestroyed) return;
      await prepare();
      const result = await commands.production.decideSuggestion(suggestion.id, 'accept');
      if (!result.ok) {
        toast('Sugestão não aplicada', { tone: 'error', description: result.refusal.message });
        return;
      }
      if (result.value.outcome === 'stale') {
        toast('O trecho mudou', { tone: 'info', description: 'Reaplique a sugestão sobre o texto atual.' });
        return;
      }
      if (suggestion.proposal.kind === 'title') {
        setLocalTitle(suggestion.proposal.text.trim());
        if (result.value.revision !== undefined) sync.adopt(result.value.revision, { ...(handle.getBody() as ArticleBody), title: suggestion.proposal.text.trim() });
        return;
      }
      const applied = applySuggestionInEditor(editor.view, { ...suggestion, state: 'ready' }, title);
      if (applied.ok && result.value.revision !== undefined) sync.adopt(result.value.revision, applied.value);
      else awaitReload(true);
      // The caret lands after the new text instead of keeping a selection that reopens the bar
      // (a selected image stays selected).
      const caret = caretAfterSelection(editor.state.selection);
      if (applied.ok && caret !== null) editor.commands.setTextSelection(caret);
      setSuggestionFocus((current) => (current?.suggestionId === suggestion.id ? null : current));
    },
    [editor, prepare, commands, sync, handle, title, setLocalTitle, awaitReload, setSuggestionFocus],
  );

  const discard = useCallback(
    async (suggestion: Suggestion) => {
      const result = await commands.production.decideSuggestion(suggestion.id, 'discard');
      if (!result.ok) {
        toast('Não foi possível descartar', { tone: 'error', description: result.refusal.message });
        return;
      }
      // Esc decides at once: one step back is always at hand.
      toast('Sugestão descartada', {
        description: suggestion.label,
        action: {
          label: 'Desfazer',
          onClick: () => {
            void commands.production.decideSuggestion(suggestion.id, 'restore').then((restored) => {
              if (!restored.ok) toast('Não foi possível desfazer', { tone: 'error', description: restored.refusal.message });
              else setSuggestionFocus({ suggestionId: suggestion.id, target: suggestion.target });
            });
          },
        },
      });
    },
    [commands, setSuggestionFocus],
  );

  /** Same request again on the passage as it is now ("Reaplicar", "Tentar de novo"). */
  const reapply = useCallback(
    async (suggestion: Suggestion) => {
      if (!editor || editor.isDestroyed) return;
      const tool = toolForSuggestion(suggestion);
      if (!tool) return;
      const located = locateSuggestionInDoc(editor.state.doc, suggestion);
      const target =
        located ??
        suggestion.target
          .map((range) => {
            const entry = findBlockEntry(editor.state.doc, range.blockId);
            return entry ? { blockId: range.blockId, from: 0, to: blockTextOf(entry.node).length } : null;
          })
          .filter((range): range is TextRange => range !== null);
      if (isOpenSuggestion(suggestion)) await commands.production.decideSuggestion(suggestion.id, 'discard');
      void startTool(tool, tool.target === 'document' ? {} : { target });
    },
    [editor, commands, startTool],
  );

  /**
   * ⌘↵ / Esc in the text (captured before ProseMirror's keymap). They decide the suggestion under
   * the caret, else the one whose bar is open: ⌘↵ accepts (a stale one is reapplied), Esc
   * discards. With text selected, Esc belongs to the selection bar. With nothing to decide, ⌘↵
   * goes to the next open suggestion and Esc stops an inline request still being written.
   */
  const decideFromKeyboard = useEffectEvent((event: globalThis.KeyboardEvent): boolean => {
    const accepting = event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
    const escaping = event.key === 'Escape';
    if (!accepting && !escaping) return false;
    if (!editor || editor.isDestroyed) return false;
    const caretEmpty = editor.state.selection.empty;
    const underCaretId = suggestionAtCaret(editor.state, liveOpen);
    const underCaret = underCaretId ? liveOpen.find((suggestion) => suggestion.id === underCaretId) : undefined;
    const target = caretEmpty ? (underCaret ?? (focusedSuggestion && !suggestionBarHidden ? focusedSuggestion : undefined)) : undefined;
    if (target) {
      const state = stateOf(target);
      if (accepting) {
        if (state === 'ready') void accept(target);
        else if (state === 'stale') void reapply(target);
        // Still being written: ⌘↵ waits (and never breaks the line).
        return true;
      }
      void discard(target);
      return true;
    }
    if (escaping && caretEmpty && !suggestionBarHidden && suggestionFocus?.runId && activeAssist?.id === suggestionFocus.runId) {
      void stopAssist();
      return true;
    }
    if (accepting) {
      nextSuggestion();
      return true;
    }
    return false;
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const dom = editor.view.dom;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (decideFromKeyboard(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    dom.addEventListener('keydown', onKey, true);
    return () => dom.removeEventListener('keydown', onKey, true);
  }, [editor]);

  return { revealSuggestion, nextSuggestion, accept, discard, reapply };
}
