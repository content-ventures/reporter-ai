'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceView } from '@content-ventures/design-system/v3';
import { COVER_BLOCK_ID, LENGTH_TARGETS, readiness, runChecks, type ArticleBody, type BlockId, type CheckResult, type Source, type TextRange } from '@/domain';
import { focusBlock, markBlocksReviewed, setArticleDecorations, setArticleWidgetHandlers, textRangeToPositions } from '@/editor';
import type { PieceView, ProductionDetail } from '@/ports';
import { articleChecksFor } from '@/registries';
import { imagesToCheck, type ImageToCheck } from './image-model';
import { articleFacts, documentTools, isBlankBody, mergeChecks, nextInOrder, type ArticleFacts } from './studio-model';
import { factsBodyOf } from './studio-session-model';
import type { StudioGeneration } from './use-studio-generation';
import type { StudioText } from './use-studio-text';

/**
 * What the studio knows about the text (status line, Checagem, outline, document tools) and the
 * jumps of the Checagem: the next AI block to review, the next quotation without a source, the
 * next image without credit, authorisation or file, and any passage the person points at.
 */
export function useStudioChecks({
  production,
  piece,
  sources,
  generation,
  text,
  setView,
}: {
  production: ProductionDetail;
  piece: PieceView;
  sources: Source[];
  generation: StudioGeneration;
  text: StudioText;
  setView: Dispatch<SetStateAction<WorkspaceView>>;
}) {
  const { body, title, editor, streaming, images, revealBlock } = text;
  const { active: generating, live, streamMode } = generation;

  // ——— Derived facts (status line, Checagem, outline, used transcript) ———
  const factsBody = useMemo<ArticleBody>(
    () => factsBodyOf(body, title, generating && live ? { fold: live.fold, mode: streamMode } : undefined),
    [generating, live, streamMode, body, title],
  );
  const facts: ArticleFacts = useMemo(() => articleFacts(factsBody, sources), [factsBody, sources]);
  const assetLookup = images.lookup;
  const checks: CheckResult[] = useMemo(() => {
    const local = runChecks(articleChecksFor(), {
      body: factsBody,
      brief: production.brief,
      sources,
      generation: { running: generating, interrupted: false },
      assets: assetLookup,
    });
    return mergeChecks(local, piece.checks);
  }, [factsBody, production.brief, sources, generating, piece.checks, assetLookup]);
  /** Images without credit, authorisation or file ("Imagens com crédito"), in reading order. */
  const imageIssues: ImageToCheck[] = useMemo(() => imagesToCheck(factsBody, assetLookup), [factsBody, assetLookup]);
  const ready = useMemo(() => readiness(checks), [checks]);
  /** No text and no image in the flow (a cover alone still offers "Gerar rascunho"). */
  const empty = isBlankBody(body) && !generating && !streaming.active;
  const lengthTarget = LENGTH_TARGETS[production.brief.length].words;
  const tools = useMemo(
    () => documentTools({ empty: isBlankBody(body), words: facts.words, target: lengthTarget, headings: facts.outline.filter((entry) => entry.level === 2).length }),
    [body, facts.words, facts.outline, lengthTarget],
  );

  // Quotations lit as used (found in the transcript) or missing.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, {
      quotes: facts.quotes.map((quote) => ({ range: quote.range, state: quote.status === 'verified' ? 'used' : 'missing' })),
    });
  }, [editor, facts.quotes]);

  // ——— Jumps ———
  /** A passage pointed at from the Checagem or the copilot: selected, in the upper third of the pane. */
  const focusRange = useCallback(
    (range: TextRange) => {
      if (!editor || editor.isDestroyed) return;
      const positions = textRangeToPositions(editor.state.doc, range);
      setView('main');
      if (!positions) {
        revealBlock(range.blockId, { caret: 'start' });
        return;
      }
      editor.chain().setTextSelection(positions).focus(null, { scrollIntoView: false }).run();
      revealBlock(range.blockId);
    },
    [editor, setView, revealBlock],
  );

  /**
   * Reviewing the AI text block by block (status line, ⌘K, Checagem, the gutter marker): the block
   * under review rises to the upper third and the status line offers "Marcar como revisado" and
   * "Próximo" — below the text, so no bar ever covers it.
   */
  const [reviewBlockId, setReviewBlockId] = useState<BlockId | null>(null);
  const nextAiBlock = useCallback(() => {
    const next = nextInOrder(facts.unreviewed, reviewBlockId);
    if (!next || !editor) return;
    setView('main');
    revealBlock(next, { caret: 'start' });
    setReviewBlockId(next);
  }, [facts.unreviewed, reviewBlockId, editor, setView, revealBlock]);
  const markReviewed = useCallback(
    (blockIds: readonly BlockId[]) => {
      if (!editor || editor.isDestroyed) return;
      markBlocksReviewed(editor, blockIds);
      const remaining = facts.unreviewed.filter((id) => !blockIds.includes(id));
      const next = nextInOrder(remaining, reviewBlockId);
      setReviewBlockId(next && remaining.length > 0 ? next : null);
      if (next && remaining.length > 0) revealBlock(next, { caret: 'start' });
    },
    [editor, facts.unreviewed, reviewBlockId, revealBlock],
  );
  const stopReview = useCallback(() => setReviewBlockId(null), []);

  // The gutter marker of an AI block ("Revisar texto da IA") starts the review on that block; the
  // block is already in view and the caret stays where it is.
  const onAiMarker = useCallback(
    (blockId: BlockId) => {
      setView('main');
      setReviewBlockId(blockId);
    },
    [setView],
  );
  useEffect(() => {
    if (editor && !editor.isDestroyed) setArticleWidgetHandlers(editor, { onAiMarker });
  }, [editor, onAiMarker]);

  /**
   * A quotation the material does not back: the caret goes into it (at its end), which opens its
   * layer — what the source says, "Usar texto da fonte", "Ver na transcrição".
   */
  const showQuote = useCallback(
    (range: TextRange) => {
      setView('main');
      revealBlock(range.blockId, { caret: range });
    },
    [setView, revealBlock],
  );
  const [quoteCursor, setQuoteCursor] = useState(-1);
  const nextMissingQuote = useCallback(() => {
    if (facts.missingQuotes.length === 0) return;
    const index = (quoteCursor + 1) % facts.missingQuotes.length;
    setQuoteCursor(index);
    const range = facts.missingQuotes[index];
    if (range) showQuote(range);
  }, [facts.missingQuotes, quoteCursor, showQuote]);

  /**
   * "Imagens com crédito" → the next image without credit, authorisation or file: a figure is
   * selected (its bar offers "Editar legenda e crédito"), the cover is brought into view.
   */
  const [imageCursor, setImageCursor] = useState<BlockId | null>(null);
  /** Bumped by each jump to a figure: its bar reopens even if it was dismissed on that figure. */
  const [figureReveal, setFigureReveal] = useState(0);
  const { revealCover } = images;
  const showImage = useCallback(
    (blockId: BlockId) => {
      if (blockId === COVER_BLOCK_ID) {
        revealCover();
        return;
      }
      if (!editor || editor.isDestroyed) return;
      setView('main');
      setFigureReveal((count) => count + 1);
      focusBlock(editor, blockId);
    },
    [editor, revealCover, setView],
  );
  const nextImageIssue = useCallback(() => {
    const next = nextInOrder(
      imageIssues.map((entry) => entry.blockId),
      imageCursor,
    );
    if (!next) return;
    setImageCursor(next);
    showImage(next);
  }, [imageIssues, imageCursor, showImage]);

  return {
    factsBody,
    facts,
    checks,
    imageIssues,
    readiness: ready,
    empty,
    tools,
    figureReveal,
    reviewBlockId,
    setReviewBlockId,
    stopReview,
    focusRange,
    showQuote,
    nextAiBlock,
    markReviewed,
    nextMissingQuote,
    showImage,
    nextImageIssue,
  };
}

export type StudioChecks = ReturnType<typeof useStudioChecks>;
