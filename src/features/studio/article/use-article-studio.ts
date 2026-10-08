'use client';

import { useMemo } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import type { GenerationKind, PersonSummary } from '@/ports';
import { useCommands, usePeople } from '@/state';
import { useFocusMode } from '@/ui/shell';
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
 * The article studio (PLAN §3.5) as one state object: the TipTap editor and its autosave, the
 * live generation streamed into the text, suggestions (cards, decorations, the bar near the
 * text), the source link between paragraphs and transcript, the copilot thread and every action
 * of the toolbar, the ⌘K group and the footer. Screens read it through `useStudio()`.
 *
 * Each concern lives in its own hook; this one composes them in dependency order and keeps the
 * shape the screens read.
 */

export type { ComposerChip, CopilotTab, GenerationState, SessionTurn, SourceTab, StudioInputs, SuggestionFocus } from './studio-types';
export { toolForSuggestion } from './studio-session-model';

export function useArticleStudio({ production, piece, draft, source, sourceError }: StudioInputs) {
  const commands = useCommands();
  const focusMode = useFocusMode();
  const peopleQuery = usePeople();
  const people = useMemo<PersonSummary[]>(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const sources = useMemo(() => (source ? [source.source] : []), [source]);

  const panes = useStudioPanes();
  const generation = useStudioGeneration({ production, piece });
  const text = useStudioText({ production, piece, draft, generation, showText: panes.showText });
  const checking = useStudioChecks({ production, piece, sources, generation, text, setView: panes.setView });
  const bar = useSuggestionBar({ draft, editor: text.editor });
  const sourceLink = useStudioSourceLink({ source, people, text, factsBody: checking.factsBody, setView: panes.setView, showSource: panes.showSource });
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
    copilotHidden: panes.copilotHidden,
  });
  const decide = useSuggestionActions({ commands, text, bar, startTool: copilot.startTool, activeAssist: copilot.activeAssist, stopAssist: copilot.stopAssist });
  const generationActions = useGenerationActions({
    commands,
    productionId: production.id,
    pieceId: piece.id,
    generation,
    prepare: text.prepare,
    setLocalTitle: text.setLocalTitle,
    setCopilotTab: panes.setCopilotTab,
  });
  const review = useStudioReview({
    commands,
    production,
    piece,
    text,
    busy: generation.active || Boolean(copilot.activeAssist),
    openCount: bar.liveOpen.length,
    empty: checking.empty,
    blockers: checking.readiness.blockers,
  });

  const { generate, stopGeneration, retryGeneration } = generationActions;
  const { stopAssist, retryRun, repeatTurn, runTool, runPreset, ask, askAboutSelection, addExcerpt } = copilot;
  const { accept, discard, reapply, revealSuggestion, nextSuggestion } = decide;
  const { focusRange, showQuote, nextAiBlock, markReviewed, stopReview, nextMissingQuote, showImage, nextImageIssue } = checking;
  const { insertQuote, takeSourceText, showInTranscript } = sourceLink;
  const { saveVersion, restoreVersion, requestReview } = review;
  const { scrollToBlock, readOnly } = text;
  const actions = useMemo(() => {
    // A tab another tab took over (A10) reads and navigates, but changes nothing: every action that
    // writes says why instead (the store refuses them too).
    const refused = () => toast('Aberta em outra aba', { tone: 'info', description: READ_ONLY_REASON });
    const writes = <Args extends unknown[], R>(action: (...args: Args) => R): ((...args: Args) => R) =>
      readOnly
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
      nextAiBlock,
      markReviewed: writes(markReviewed),
      stopReview,
      nextMissingQuote,
      insertQuote: writes(insertQuote),
      useSourceText: writes(takeSourceText),
      showInTranscript,
      addExcerpt,
      saveVersion: writes(saveVersion),
      restoreVersion: writes(restoreVersion),
      requestReview: writes(requestReview),
      scrollToBlock,
      showImage,
      nextImageIssue,
    };
  }, [readOnly, generate, stopGeneration, retryGeneration, stopAssist, retryRun, repeatTurn, runTool, runPreset, ask, askAboutSelection, accept, discard, reapply, revealSuggestion, nextSuggestion, focusRange, showQuote, nextAiBlock, markReviewed, stopReview, nextMissingQuote, insertQuote, takeSourceText, showInTranscript, addExcerpt, saveVersion, restoreVersion, requestReview, scrollToBlock, showImage, nextImageIssue]);

  useStudioCommands({
    text,
    facts: checking.facts,
    imageIssues: checking.imageIssues,
    tools: checking.tools,
    generating: generation.active,
    requestBlocked: review.requestBlocked,
    requestFix: review.requestFix,
    reviewLink: review.reviewLink,
    focusMode,
    actions: {
      saveVersion: actions.saveVersion,
      focusComposer: panes.focusComposer,
      nextAiBlock,
      nextMissingQuote,
      nextImageIssue,
      nextSuggestion,
      showChecks: () => panes.showCopilot('checks'),
      togglePanels: panes.togglePanels,
      runTool: actions.runTool,
      requestReview: actions.requestReview,
      openReview: review.openReview,
    },
  });

  /** The brief changed after the text on screen was generated ("Gerar nova versão" follows the new one). */
  const briefChanged = briefChangedSince(generation.run, production.brief);

  return {
    production,
    piece,
    draft,
    /** The article's own status for the header ("Aprovado · v2"), never the carousel's. */
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
    body: text.body,
    facts: checking.facts,
    checks: checking.checks,
    images: text.images,
    imageIssues: checking.imageIssues,
    figureReveal: checking.figureReveal,
    readiness: checking.readiness,
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
    reviewBlockId: checking.reviewBlockId,
    setReviewBlockId: checking.setReviewBlockId,
    thread: copilot.thread,
    activeAssist: copilot.activeAssist,
    composer: copilot.composer,
    setComposer: copilot.setComposer,
    chips: copilot.chips,
    addChip: copilot.addChip,
    removeChip: copilot.removeChip,
    bindComposer: panes.bindComposer,
    bindWorkspace: panes.bindWorkspace,
    sourceTab: panes.sourceTab,
    setSourceTab: panes.setSourceTab,
    copilotTab: panes.copilotTab,
    setCopilotTab: panes.setCopilotTab,
    view: panes.view,
    setView: panes.setView,
    showCopilot: panes.showCopilot,
    showSource: panes.showSource,
    focusComposer: panes.focusComposer,
    highlightVersionId: review.highlightVersionId,
    setHighlightVersionId: review.setHighlightVersionId,
    focusMode,
    requestBlocked: review.requestBlocked,
    requesting: review.requesting,
    reviewLink: review.reviewLink,
    /** The approved version is the text on screen (editing it starts a new draft). */
    approvedOnScreen: review.approved,
    /** Another tab of this browser saves the workspace: this one is read-only (A10). */
    readOnly: text.readOnly,
    actions,
  };
}

export type Studio = ReturnType<typeof useArticleStudio>;

export type { GenerationKind };
