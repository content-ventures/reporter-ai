'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { WorkspaceView } from '@content-ventures/design-system/v3';
import { quoteBlock, segmentRef, type ArticleBody, type BlockId, type TextRange } from '@/domain';
import { blockIdOf, createBlockIdFactory, findBlockEntry, insertBlocks, setArticleDecorations, textRangeToPositions } from '@/editor';
import type { PersonSummary, SourceDetail } from '@/ports';
import { blockSegmentIds, blocksCitingSegment, viewerSegments, type ViewerSegment } from './studio-model';
import type { StudioText } from './use-studio-text';

export type SourceLink = { blockIds: BlockId[]; segmentId: string | null; from: 'text' | 'transcript' };

/**
 * The link between the text and its source (PLAN §3.5 "Fonte"): the paragraph under the caret
 * lights its transcript line and a transcript line lights the paragraphs citing it. Also what goes
 * from the transcript into the text: a quotation ("Inserir como citação") or the transcript's own
 * words over a quotation that drifted ("Usar texto da fonte").
 */
export function useStudioSourceLink({
  source,
  people,
  text,
  factsBody,
  setView,
  showMaterial,
}: {
  source: SourceDetail | undefined;
  people: PersonSummary[];
  text: StudioText;
  factsBody: ArticleBody;
  setView: Dispatch<SetStateAction<WorkspaceView>>;
  showMaterial: () => void;
}) {
  const { editor, scrollToBlock, caretWasPlaced } = text;
  const [quoteIds] = useState(() => createBlockIdFactory({ prefix: 'cit' }));
  const segments: ViewerSegment[] = useMemo(
    () => (source ? viewerSegments(source.version.content.segments, source.source.speakers, people) : []),
    [source, people],
  );
  const [link, setLink] = useState<SourceLink | null>(null);

  const linkBlock = useCallback(
    (blockId: BlockId | null) => {
      if (!editor || editor.isDestroyed) return;
      if (!blockId) {
        setLink((current) => (current?.from === 'text' ? null : current));
        return;
      }
      const entry = findBlockEntry(editor.state.doc, blockId);
      const segmentIds = entry ? blockSegmentIds({ sourceRefs: entry.node.attrs.sourceRefs ?? undefined }) : [];
      setLink((current) => {
        if (segmentIds.length === 0) return current?.from === 'text' ? null : current;
        if (current?.from === 'text' && current.blockIds[0] === blockId) return current;
        return { blockIds: [blockId], segmentId: segmentIds[0] ?? null, from: 'text' };
      });
    },
    [editor],
  );

  // The excerpt follows the caret, not the pointer: placing the caret or selecting text in a
  // paragraph lights its transcript line (and the transcript scrolls to it once). Moving the mouse
  // over the text never scrolls anything. A drag selection settles on mouseup; quick caret moves
  // settle after a short pause, so arrowing through the text does not jump the transcript per line.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return undefined;
    const dom = editor.view.dom;
    let timer: number | undefined;
    let dragging = false;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (editor.isDestroyed || dragging || !editor.isFocused) return;
        const head = editor.state.selection.$head;
        linkBlock(head.depth >= 1 ? blockIdOf(head.node(1)) : null);
      }, 220);
    };
    const onPointerDown = () => {
      dragging = true;
    };
    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      settle();
    };
    editor.on('selectionUpdate', settle);
    editor.on('focus', settle);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.clearTimeout(timer);
      editor.off('selectionUpdate', settle);
      editor.off('focus', settle);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [editor, linkBlock]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, { activeSourceBlockIds: link?.blockIds ?? [] });
  }, [editor, link]);

  const linkSegment = useCallback(
    (segmentId: string) => {
      const blockIds = blocksCitingSegment(factsBody, segmentId);
      setLink({ blockIds, segmentId, from: 'transcript' });
      if (blockIds[0]) {
        setView('main');
        scrollToBlock(blockIds[0]);
      }
    },
    [factsBody, scrollToBlock, setView],
  );

  /** "Ver na transcrição": the panel's Material tab on the segment, lit. */
  const showInTranscript = useCallback(
    (segmentId: string) => {
      setLink({ blockIds: blocksCitingSegment(factsBody, segmentId), segmentId, from: 'transcript' });
      showMaterial();
    },
    [factsBody, showMaterial],
  );

  /** "Usar texto da fonte": the quotation takes the transcript's words (one undo reverts it). */
  const takeSourceText = useCallback(
    (range: TextRange, words: string) => {
      if (!editor || editor.isDestroyed) return;
      const positions = textRangeToPositions(editor.state.doc, range);
      if (!positions) return;
      setView('main');
      editor.view.dispatch(editor.state.tr.insertText(words, positions.from, positions.to).scrollIntoView());
      editor.commands.focus();
    },
    [editor, setView],
  );

  /** "Inserir como citação": at the caret once placed, else after the last paragraph citing the line. */
  const insertQuote = useCallback(
    (selected: { segmentId: string; start: number; end: number; text: string }) => {
      if (!editor || editor.isDestroyed || !source) return;
      const quoted = selected.text.replace(/\s+/g, ' ').trim();
      if (!quoted) return;
      const block = quoteBlock(quoteIds(), quoted, {
        sourceRefs: [segmentRef(source.source.id, source.version.number, selected.segmentId, { from: selected.start, to: selected.end })],
      });
      const citing = blocksCitingSegment(factsBody, selected.segmentId);
      const after = citing[citing.length - 1];
      const where = caretWasPlaced() && editor.state.selection.$from.depth > 0 ? 'selection' : after ? { after } : 'end';
      insertBlocks(editor, [block], where);
      setView('main');
      editor.commands.focus();
    },
    [editor, source, quoteIds, factsBody, caretWasPlaced, setView],
  );

  return { segments, link, linkSegment, showInTranscript, takeSourceText, insertQuote };
}
