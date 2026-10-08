'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceView } from '@content-ventures/design-system/v3';
import {
  articleImageSlots,
  COVER_BLOCK_ID,
  readiness,
  runChecks,
  type ArticleBody,
  type BlockId,
  type CheckResult,
  type ImageSlotUse,
  type Source,
  type TextRange,
} from '@/domain';
import { focusBlock, setArticleDecorations, setTextReview, textRangeToPositions } from '@/editor';
import type { PieceView, ProductionDetail } from '@/ports';
import { articleChecksFor } from '@/registries';
import { imagesToCheck, type ImageToCheck } from './image-model';
import { articleFacts, documentTools, isBlankBody, mergeChecks, nextInOrder, type ArticleFacts } from './studio-model';
import { factsBodyOf } from './studio-session-model';
import type { StudioGeneration } from './use-studio-generation';
import type { StudioText } from './use-studio-text';

/**
 * What the studio knows about the text (status line, Checagem, outline, document tools) and the
 * jumps of the Checagem: the review of the whole text, the next quotation without a source, the
 * next image without credit, authorisation or file, the next suggested image to fill, and any
 * passage the person points at.
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
      ...(production.charsAvailable !== undefined ? { materialChars: production.charsAvailable } : {}),
    });
    return mergeChecks(local, piece.checks);
  }, [factsBody, production.brief, production.charsAvailable, sources, generating, piece.checks, assetLookup]);
  /** Images without credit, authorisation or file ("Imagens com crédito"), in reading order. */
  const imageIssues: ImageToCheck[] = useMemo(() => imagesToCheck(factsBody, assetLookup), [factsBody, assetLookup]);
  /**
   * Images the generation suggested and nobody filled yet ("Imagens sugeridas"), in reading order.
   * Figures only: the cover's suggestion stays with "Imagem de destaque", which is optional (D04).
   */
  const imageSlots: ImageSlotUse[] = useMemo(() => articleImageSlots(factsBody).filter((use) => use.role === 'figure'), [factsBody]);
  const ready = useMemo(() => readiness(checks), [checks]);
  /** No text and no image in the flow (a cover alone still offers "Gerar rascunho"). */
  const empty = isBlankBody(body) && !generating && !streaming.active;
  const size = production.brief.size;
  const tools = useMemo(
    () => documentTools({ empty: isBlankBody(body), characters: facts.characters, size, headings: facts.outline.filter((entry) => entry.level === 2).length }),
    [body, facts.characters, facts.outline, size],
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
   * The review of the AI text is ONE for the whole draft (footer "Marcar como revisado", the
   * pre-send dialog, ⌘K): every AI block flips together, in one undoable step. The state is the
   * blocks' own (`ai`), so new AI text (a run, an accepted suggestion) reopens it by itself and a
   * person typing never does. The gutter marker of an AI block is only a cue.
   */
  const markTextReviewed = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    setTextReview(editor, 'reviewed');
  }, [editor]);
  const unmarkTextReviewed = useCallback(() => {
    if (!editor || editor.isDestroyed) return;
    setTextReview(editor, 'unreviewed');
  }, [editor]);

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

  /**
   * "Imagens sugeridas" → a suggested image: selected in the upper third of the pane, which opens
   * its bar (Enviar imagem · Usar link · Remover sugestão); the cover's suggestion is brought into view.
   */
  const [slotCursor, setSlotCursor] = useState<BlockId | null>(null);
  const showImageSlot = useCallback(
    (blockId: BlockId) => {
      if (blockId === COVER_BLOCK_ID) {
        revealCover();
        return;
      }
      if (!editor || editor.isDestroyed) return;
      setView('main');
      setFigureReveal((count) => count + 1);
      revealBlock(blockId, { caret: 'start' });
    },
    [editor, revealCover, revealBlock, setView],
  );
  const nextImageSlot = useCallback(() => {
    const next = nextInOrder(
      imageSlots.map((use) => use.blockId),
      slotCursor,
    );
    if (!next) return;
    setSlotCursor(next);
    showImageSlot(next);
  }, [imageSlots, slotCursor, showImageSlot]);

  return {
    factsBody,
    facts,
    checks,
    imageIssues,
    imageSlots,
    readiness: ready,
    empty,
    tools,
    figureReveal,
    focusRange,
    showQuote,
    markTextReviewed,
    unmarkTextReviewed,
    nextMissingQuote,
    showImage,
    nextImageIssue,
    showImageSlot,
    nextImageSlot,
  };
}

export type StudioChecks = ReturnType<typeof useStudioChecks>;
