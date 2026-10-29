'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast, type WorkspaceView } from '@content-ventures/design-system/v3';
import { paragraphBlock, quoteBlock, type ArticleBody, type BlockId, type QuoteCheck, type SourceRef, type TextRange } from '@/domain';
import { blockIdOf, createBlockIdFactory, findBlockEntry, insertBlocks, recoverSourceQuote, setArticleDecorations, textRangeToPositions } from '@/editor';
import type { PersonSummary, SourceDetail } from '@/ports';
import { blocksCitingSegment, viewerSegments, type ClosestExcerpt, type SourceScope, type ViewerSegment } from './studio-model';
import type { StudioText } from './use-studio-text';
import { studioSourceExcerpt, type StudioExcerptSelection } from './studio-source-excerpt';

export type SourceLink = SourceScope & { blockIds: BlockId[]; segmentId: string; from: 'text' | 'transcript' };

/**
 * The link between the text and its source (PLAN §3.5 "Fonte"): the paragraph under the caret
 * lights its transcript line and a transcript line lights the paragraphs citing it. Also what goes
 * from the transcript into the text: a quotation ("Inserir como citação") or the transcript's own
 * words over a quotation that drifted ("Usar texto da fonte").
 */
export function useStudioSourceLink({
  source,
  sourceDetails,
  blockedReason,
  people,
  text,
  factsBody,
  setView,
  showMaterial,
  showSource,
}: {
  source: SourceDetail | undefined;
  sourceDetails: SourceDetail[] | undefined;
  blockedReason: string | null;
  people: PersonSummary[];
  text: StudioText;
  factsBody: ArticleBody;
  setView: Dispatch<SetStateAction<WorkspaceView>>;
  showMaterial: () => void;
  showSource: (scope: SourceScope) => void;
}) {
  const { editor, scrollToBlock, caretWasPlaced } = text;
  const [quoteIds] = useState(() => createBlockIdFactory({ prefix: 'cit' }));
  const segments: ViewerSegment[] = useMemo(
    () => (source ? viewerSegments(source.version.content.segments, source.source.speakers, people, source.source.parts) : []),
    [source, people],
  );
  const [link, setLink] = useState<SourceLink | null>(null);
  const visibleLink = source && link?.sourceId === source.source.id && link.sourceVersion === source.version.number ? link : null;

  const linkBlock = useCallback(
    (blockId: BlockId | null) => {
      if (!editor || editor.isDestroyed) return;
      if (!blockId) {
        setLink((current) => (current?.from === 'text' ? null : current));
        return;
      }
      const entry = findBlockEntry(editor.state.doc, blockId);
      const ref: SourceRef | undefined = entry?.node.attrs.sourceRefs?.find((ref: SourceRef) => ref.locator.type === 'segment');
      if (ref?.locator.type === 'segment') showSource(ref);
      setLink((current) => {
        if (ref?.locator.type !== 'segment') return current?.from === 'text' ? null : current;
        if (current?.from === 'text' && current.blockIds[0] === blockId && current.sourceId === ref.sourceId && current.sourceVersion === ref.sourceVersion && current.segmentId === ref.locator.segmentId) return current;
        return { blockIds: [blockId], sourceId: ref.sourceId, sourceVersion: ref.sourceVersion, segmentId: ref.locator.segmentId, from: 'text' };
      });
    },
    [editor, showSource],
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
    const readCaret = () => {
      if (editor.isDestroyed) return;
      const head = editor.state.selection.$head;
      linkBlock(head.depth >= 1 ? blockIdOf(head.node(1)) : null);
    };
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (editor.isDestroyed || dragging || !editor.isFocused) return;
        readCaret();
      }, 220);
    };
    // A narrow pane switch hides the editor before the debounce fires. Finish the actual
    // caret movement on blur, so opening Material still follows its exact historical source.
    const onBlur = () => {
      window.clearTimeout(timer);
      readCaret();
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
    editor.on('blur', onBlur);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.clearTimeout(timer);
      editor.off('selectionUpdate', settle);
      editor.off('focus', settle);
      editor.off('blur', onBlur);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [editor, linkBlock]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, { activeSourceBlockIds: visibleLink?.blockIds ?? [] });
  }, [editor, visibleLink]);

  const linkSegment = useCallback(
    (segmentId: string) => {
      if (!source) return;
      const scope = { sourceId: source.source.id, sourceVersion: source.version.number };
      const blockIds = blocksCitingSegment(factsBody, segmentId, scope);
      setLink({ ...scope, blockIds, segmentId, from: 'transcript' });
      if (blockIds[0]) {
        setView('main');
        scrollToBlock(blockIds[0]);
      }
    },
    [source, factsBody, scrollToBlock, setView],
  );

  /** "Ver na transcrição": the panel's Material tab on the segment, lit. */
  const showInTranscript = useCallback(
    (ref: SourceRef) => {
      if (ref.locator.type !== 'segment') return;
      const segmentId = ref.locator.segmentId;
      showSource(ref);
      setLink({ sourceId: ref.sourceId, sourceVersion: ref.sourceVersion, blockIds: blocksCitingSegment(factsBody, segmentId, ref), segmentId, from: 'transcript' });
      showMaterial();
    },
    [factsBody, showMaterial, showSource],
  );

  /** "Usar texto da fonte": the quotation takes the transcript's words (one undo reverts it). */
  const takeSourceText = useCallback(
    (quote: Pick<QuoteCheck, 'range' | 'text' | 'sourceRefs'>, excerpt: ClosestExcerpt) => {
      if (!editor || editor.isDestroyed) return;
      const sources = sourceDetails?.map(detail => detail.source) ?? [];
      if (excerpt.readOnly || blockedReason && sources.some(source => source.id === excerpt.ref.sourceId && source.memory)) {
        toast('Confira a fonte do banco antes de corrigir a citação.'); return;
      }
      if (!recoverSourceQuote(editor.view, quote, excerpt, sources)) {
        toast('A citação ou a fonte mudou. Confira o trecho novamente.'); return;
      }
      setView('main');
      editor.commands.focus();
    },
    [editor, sourceDetails, blockedReason, setView],
  );

  /** Explicit editorial edits keep their original references for the subsequent evidence check. */
  const replacePassage = useCallback((range: TextRange, words: string) => {
    if (!editor || editor.isDestroyed) return;
    const positions = textRangeToPositions(editor.state.doc, range);
    if (!positions) return;
    setView('main');
    editor.view.dispatch(editor.state.tr.insertText(words, positions.from, positions.to).scrollIntoView());
    editor.commands.focus();
  }, [editor, setView]);

  /** "Inserir como citação": at the caret once placed, else after the last paragraph citing the line. */
  const insertQuote = useCallback(
    (selected: StudioExcerptSelection) => {
      if (!editor || editor.isDestroyed) return;
      const excerpt = studioSourceExcerpt(sourceDetails, source, selected);
      if (!excerpt) { toast('Confira a fonte e selecione o trecho novamente.'); return; }
      if (blockedReason && sourceDetails?.some(detail => detail.source.id === excerpt.sourceId && detail.source.memory)) {
        toast('Confira as evidências antes de inserir', { description: blockedReason }); return;
      }
      const makeBlock = excerpt.kind === 'statistic' ? paragraphBlock : quoteBlock;
      const block = makeBlock(quoteIds(), excerpt.text, { sourceRefs: [excerpt.ref] });
      const citing = blocksCitingSegment(factsBody, selected.segmentId, excerpt);
      const after = citing[citing.length - 1];
      const where = caretWasPlaced() && editor.state.selection.$from.depth > 0 ? 'selection' : after ? { after } : 'end';
      insertBlocks(editor, [block], where);
      setView('main');
      editor.commands.focus();
    },
    [editor, source, sourceDetails, blockedReason, quoteIds, factsBody, caretWasPlaced, setView],
  );

  return { segments, link: visibleLink, linkSegment, showInTranscript, takeSourceText, replacePassage, insertQuote };
}
