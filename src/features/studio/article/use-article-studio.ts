'use client';

import { useCallback, useMemo, useState } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { firstName, lockedMessage, sendChecklist, type SendItemId, type SendTarget } from '@/domain';
import type { GenerationKind, PersonSummary, PieceApproval } from '@/ports';
import { useCommands, usePeople, useSession } from '@/state';
import { briefChangedSince, READ_ONLY_REASON, studioBadge } from './studio-session-model';
import type { GenerationState, StudioInputs } from './studio-types';
import { useStudioChecks } from './use-studio-checks';
import { useStudioCommands } from './use-studio-commands';
import { useStudioCopilot } from './use-studio-copilot';
import { useGenerationActions, useStudioGeneration } from './use-studio-generation';
import { useStudioPanes } from './use-studio-panes';
import { useStudioReview } from './use-studio-review';
import { useStudioSourceLink } from './use-studio-source-link';
import { useSuggestionActions, useSuggestionBar } from './use-studio-suggestions';
import { useStudioText } from './use-studio-text';

/**
 * The article studio (D2 "Documento + Assistente") as one state object: the TipTap editor and its
 * autosave, the live generation streamed into the text, suggestions in the text (decorations and
 * the bar under the passage), the link between paragraphs and the interview, the assistant
 * thread, the approval of the article (the pre-send checklist read live from the text on screen,
 * the lock while it waits for a decision), the one panel and the one drawer, and every action of
 * the toolbar, the footer, ⌘K and the header. Screens read it through `useStudio()`.
 *
 * Each concern lives in its own hook; this one composes them in dependency order.
 */

export type { ComposerChip, GenerationState, PanelTab, SessionTurn, StudioDialog, StudioInputs, SuggestionFocus } from './studio-types';
export { toolForSuggestion } from './studio-session-model';

export function useArticleStudio({ production, piece, draft, source, sourceError }: StudioInputs) {
  const commands = useCommands();
  const session = useSession();
  const peopleQuery = usePeople();
  const people = useMemo<PersonSummary[]>(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const sources = useMemo(() => (source ? [source.source] : []), [source]);
  const isAdmin = session.data?.current?.roles.includes('admin') ?? false;

  // ——— Approval: who may do what, and the lock while the text waits for a decision (D8) ———
  const stored = production.approvals.article;
  const canEdit = stored?.viewer.canEdit ?? true;
  const locked = stored?.locked ?? false;

  const panes = useStudioPanes();
  const { showPanel } = panes;
  const generation = useStudioGeneration({ production, piece });
  const text = useStudioText({ production, piece, draft, generation, showText: panes.showText, locked: locked || !canEdit });
  const checking = useStudioChecks({ production, piece, sources, generation, text, setView: panes.setView });
  const bar = useSuggestionBar({ draft, editor: text.editor });
  const showMaterial = useCallback(() => showPanel('material'), [showPanel]);
  const sourceLink = useStudioSourceLink({ source, people, text, factsBody: checking.factsBody, setView: panes.setView, showMaterial });
  const copilot = useStudioCopilot({
    commands,
    production,
    piece,
    text,
    suggestions: bar.suggestions,
    liveOpen: bar.liveOpen,
    setSuggestionFocus: bar.setSuggestionFocus,
    segments: sourceLink.segments,
    focusComposer: panes.focusComposer,
    copilotHidden: panes.assistantHidden,
  });
  const decide = useSuggestionActions({ commands, text, bar, startTool: copilot.startTool, activeAssist: copilot.activeAssist, stopAssist: copilot.stopAssist });
  const generationActions = useGenerationActions({
    commands,
    productionId: production.id,
    pieceId: piece.id,
    generation,
    prepare: text.prepare,
    setLocalTitle: text.setLocalTitle,
  });
  const review = useStudioReview({ commands, piece, text });

  /**
   * "Antes de enviar", read from the text on screen (not the last autosave): the footer, the
   * Checagem and the pre-send dialog say the same thing while the person fixes it.
   */
  const characters = checking.facts.characters;
  const size = production.brief.size;
  const sendItems = useMemo(
    () =>
      sendChecklist({
        kind: 'article',
        checks: checking.checks,
        openSuggestionIds: bar.liveOpen.map((suggestion) => suggestion.id),
        running: generation.active,
        empty: checking.empty,
        size,
        characters,
      }),
    [checking.checks, bar.liveOpen, generation.active, checking.empty, size, characters],
  );
  const approval = useMemo<PieceApproval | undefined>(() => (stored ? { ...stored, send: { ...stored.send, items: sendItems } } : undefined), [stored, sendItems]);

  // ——— Jumps from the footer, the Checagem and the dialog ("Ir ao trecho", "Revisar"…) ———
  /** Bumped to bring the title into edition with the caret in it ("Ir ao título"). */
  const [titleFocus, setTitleFocus] = useState(0);
  const { setView } = panes;
  const focusTitle = useCallback(() => {
    setView('main');
    setTitleFocus((count) => count + 1);
  }, [setView]);
  const { editor } = text;
  const { nextSuggestion, revealSuggestion } = decide;
  const { nextMissingQuote, nextImageSlot, nextImageIssue, showImage, showImageSlot, focusRange, markTextReviewed, unmarkTextReviewed } = checking;
  const liveOpen = bar.liveOpen;
  const jumpTo = useCallback(
    (target: SendTarget | undefined, id?: SendItemId) => {
      const item = id ?? sendItems.find((entry) => entry.action?.target === target)?.id;
      setView('main');
      switch (item) {
        case 'suggestions':
          nextSuggestion();
          return;
        case 'quotes':
          nextMissingQuote();
          return;
        case 'text-review':
          markTextReviewed();
          return;
        case 'images':
          nextImageSlot();
          return;
        case 'image-credits':
          nextImageIssue();
          return;
        case 'title':
          focusTitle();
          return;
        case 'empty':
          editor?.commands.focus('start');
          return;
        case 'generation':
          editor?.commands.focus('end');
          return;
        case 'size':
          showPanel('checks');
          return;
        default:
          break;
      }
      if (target?.kind === 'suggestion') {
        const suggestion = liveOpen.find((entry) => entry.id === target.suggestionId);
        if (suggestion) revealSuggestion(suggestion, { caret: true });
        else nextSuggestion();
      } else if (target?.kind === 'ranges' && target.ranges[0]) {
        if (item === 'image-alt') showImage(target.ranges[0].blockId);
        else focusRange(target.ranges[0]);
      } else if (target?.kind === 'check' && target.checkId === 'article.title') focusTitle();
      else showPanel('checks');
    },
    [sendItems, setView, nextSuggestion, nextMissingQuote, markTextReviewed, nextImageSlot, nextImageIssue, focusTitle, editor, showPanel, liveOpen, revealSuggestion, showImage, focusRange],
  );

  const { generate, stopGeneration, retryGeneration } = generationActions;
  const { stopAssist, retryRun, repeatTurn, runTool, runPreset, ask, askAboutSelection, addExcerpt } = copilot;
  const { accept, discard, reapply } = decide;
  const { showQuote } = checking;
  const { insertQuote, takeSourceText, showInTranscript } = sourceLink;
  const { saveVersion, restoreVersion, undoChanges } = review;
  const { scrollToBlock, readOnly } = text;
  /** Why nothing may change the text here, said when someone tries (null: it may). */
  const refusal = readOnly ? READ_ONLY_REASON : locked ? lockedMessage('article', firstName(stored?.request?.assignee?.name) || undefined) : null;
  const actions = useMemo(() => {
    // A tab another tab took over (A10), or a text waiting for approval (D8), reads and navigates
    // but changes nothing: every action that writes says why instead (the store refuses them too).
    // Someone who only reads (an approver) never sees those actions.
    const refused = () =>
      readOnly ? toast('Aberta em outra aba', { tone: 'info', description: READ_ONLY_REASON }) : refusal ? toast(refusal, { tone: 'info' }) : undefined;
    const writes = <Args extends unknown[], R>(action: (...args: Args) => R): ((...args: Args) => R) =>
      refusal || !canEdit
        ? () => {
            refused();
            return undefined as R;
          }
        : action;
    return {
      generate: writes(generate),
      stopGeneration,
      retryGeneration: writes(retryGeneration),
      stopAssist,
      retryRun: writes(retryRun),
      repeatTurn: writes(repeatTurn),
      runTool: writes(runTool),
      runPreset: writes(runPreset),
      ask: writes(ask),
      askAboutSelection: writes(askAboutSelection),
      accept: writes(accept),
      discard: writes(discard),
      reapply: writes(reapply),
      revealSuggestion,
      nextSuggestion,
      focusRange,
      showQuote,
      markTextReviewed: writes(markTextReviewed),
      unmarkTextReviewed: writes(unmarkTextReviewed),
      nextMissingQuote,
      insertQuote: writes(insertQuote),
      useSourceText: writes(takeSourceText),
      showInTranscript,
      addExcerpt,
      saveVersion: writes(saveVersion),
      restoreVersion: writes(restoreVersion),
      undoChanges,
      scrollToBlock,
      showImage,
      showImageSlot,
      nextImageIssue,
      nextImageSlot,
      jumpTo,
      focusTitle,
    };
  }, [refusal, readOnly, canEdit, generate, stopGeneration, retryGeneration, stopAssist, retryRun, repeatTurn, runTool, runPreset, ask, askAboutSelection, accept, discard, reapply, revealSuggestion, nextSuggestion, focusRange, showQuote, markTextReviewed, unmarkTextReviewed, nextMissingQuote, insertQuote, takeSourceText, showInTranscript, addExcerpt, saveVersion, restoreVersion, undoChanges, scrollToBlock, showImage, showImageSlot, nextImageIssue, nextImageSlot, jumpTo, focusTitle]);

  /** The brief changed after the text on screen was generated ("Reescrever" follows the new one). */
  const briefChanged = briefChangedSince(generation.run, production.brief);

  useStudioCommands({
    facts: checking.facts,
    imageIssues: checking.imageIssues,
    imageSlots: checking.imageSlots,
    tools: checking.tools,
    generating: generation.active,
    editable: canEdit && !refusal,
    hasCover: Boolean(text.body.cover),
    actions: {
      saveVersion: actions.saveVersion,
      focusComposer: panes.focusComposer,
      markTextReviewed: actions.markTextReviewed,
      nextMissingQuote,
      nextImageIssue,
      nextImageSlot,
      insertImage: text.images.insertImage,
      openCover: () => text.images.openCover('choose'),
      runTool: actions.runTool,
      openDialog: panes.openDialog,
      showChecks: () => showPanel('checks'),
    },
  });

  return {
    production,
    piece,
    draft,
    isAdmin,
    /** The article's own status for the header (never the carousel's), or "Falta autorização". */
    articleStatus: studioBadge(piece, production.status),
    briefChanged,
    source,
    sourceError,
    sources,
    noteUserScroll: text.noteUserScroll,
    people,
    segments: sourceLink.segments,
    editor: text.editor,
    handle: text.handle,
    sync: text.sync,
    title: text.title,
    storedTitle: text.storedTitle,
    commitTitle: text.commitTitle,
    titleFocus,
    body: text.body,
    facts: checking.facts,
    checks: checking.checks,
    images: text.images,
    imageIssues: checking.imageIssues,
    /** Suggested images still to fill in the text (figures, reading order). */
    imageSlots: checking.imageSlots,
    figureReveal: checking.figureReveal,
    empty: checking.empty,
    documentTools: checking.tools,
    streaming: text.streaming,
    generation: {
      run: generation.run,
      runId: generation.runId,
      live: generation.live,
      active: generation.active,
      // A run of an earlier session continues from its snapshot, unless its material or brief changed.
      retryable: generation.live !== undefined && generation.live.meta.canRetry !== false,
      version: piece.versions.find((version) => version.runId && version.runId === generation.runId),
    } satisfies GenerationState,
    suggestions: bar.suggestions,
    openSuggestions: bar.liveOpen,
    stateOf: bar.stateOf,
    focusedSuggestion: bar.focusedSuggestion,
    suggestionFocus: bar.suggestionFocus,
    setSuggestionFocus: bar.setSuggestionFocus,
    suggestionBarHidden: bar.suggestionBarHidden,
    hideSuggestionBar: bar.hideSuggestionBar,
    link: sourceLink.link,
    linkSegment: sourceLink.linkSegment,
    reviewNote: review.reviewNote,
    thread: copilot.thread,
    activeAssist: copilot.activeAssist,
    composer: copilot.composer,
    setComposer: copilot.setComposer,
    chips: copilot.chips,
    addChip: copilot.addChip,
    removeChip: copilot.removeChip,
    bindComposer: panes.bindComposer,
    bindWorkspace: panes.bindWorkspace,
    panes,
    /** The article's approval with the checklist of the text on screen. */
    approval,
    sendItems,
    /** The text waits for a decision: nothing changes it until it is withdrawn or decided (D8). */
    locked,
    /** The viewer may edit the article (an approver reads it). */
    canEdit,
    /** Why the text cannot change here right now (another tab, the lock), for disabled controls. */
    refusal,
    prepareSend: review.prepareSend,
    /** Another tab of this browser saves the workspace: this one is read-only (A10). */
    readOnly: text.readOnly,
    actions,
  };
}

export type Studio = ReturnType<typeof useArticleStudio>;

export type { GenerationKind };
