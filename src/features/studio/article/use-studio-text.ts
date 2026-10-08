'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { proseWidgets } from '@content-ventures/design-system/v3';
import { bodyHash, type ArticleBody, type BlockId, type TextRange } from '@/domain';
import {
  findBlockEntry,
  focusBlock,
  selectionInfo,
  textRangeToPositions,
  setArticleBody,
  useArticleEditor,
  useEditorRunStream,
  useStreamingInfo,
  EMPTY_SELECTION_INFO,
  type Editor,
  type SelectionInfo,
} from '@/editor';
import type { DraftView, PieceView, ProductionDetail } from '@/ports';
import { useRunListener, useTabSync } from '@/state';
import { revealInUpperThird } from './reveal';
import { useArticleImages } from './use-article-images';
import { useDraftSync, type DraftSync } from './use-draft-sync';
import type { StudioGeneration } from './use-studio-generation';

/**
 * The text of the studio: the title, the TipTap editor with its images and autosave, the
 * generation streamed into it (the view follows the block being written unless the person
 * scrolled away), external changes to the draft (generation settled, restore, another tab) and
 * `prepare`, which every action awaits so it reads the text as it is on screen.
 */
export function useStudioText({
  production,
  piece,
  draft,
  generation,
  showText,
  locked,
}: {
  production: ProductionDetail;
  piece: PieceView;
  draft: DraftView;
  generation: StudioGeneration;
  showText: () => void;
  /**
   * Nothing may change the text here: it waits for approval (D8, "Retirar envio para editar") or
   * the viewer reads only. The editor is not editable before the first keystroke.
   */
  locked: boolean;
}) {
  const pieceId = piece.id;
  const productionId = production.id;

  // ——— Title and editor ———
  const [localTitle, setLocalTitle] = useState<string | null>(null);
  const sync: DraftSync = useDraftSync(pieceId, { revision: draft.revision, body: draft.body as ArticleBody });
  const [body, setBody] = useState<ArticleBody>(draft.body as ArticleBody);
  const storedTitle = (draft.body as ArticleBody).title;
  const title = localTitle ?? (storedTitle || (generation.active ? (generation.live?.fold.title ?? '') : ''));

  // ——— Images (cover and figures): display data and paste/drop, handed to the editor ———
  const editorRef = useRef<Editor | null>(null);
  const images = useArticleImages({ productionId, body, editorRef, showText, locked: generation.active || locked });
  /** Another tab of this browser saves this workspace now: the text is read-only here (A10). */
  const { readOnly } = useTabSync();

  const handle = useArticleEditor({
    initialBody: draft.body as ArticleBody,
    title,
    label: 'Texto do artigo',
    readOnly: readOnly || locked,
    // The proposal read in the paragraph and the AI marker in the gutter come from the DS factory.
    widgets: proseWidgets,
    // An empty draft says "Ainda não há texto" under it (or the generation writes): no second
    // call to action inside the text.
    placeholder: { document: () => '' },
    onChange: (next) => {
      setBody(next);
      void sync.save(next);
    },
    figureSources: images.sources,
    ...images.input,
  });
  const { editor } = handle;
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEditorRunStream(editor, generation.runId, { mode: generation.streamMode });
  const streaming = useStreamingInfo(editor);

  // ——— The text follows the block being written, unless the person scrolled away ———
  const userScrolledAt = useRef(0);
  const noteUserScroll = useCallback(() => {
    userScrolledAt.current = Date.now();
  }, []);
  const streamingBlock = streaming.blockIds[streaming.blockIds.length - 1];
  const { streamSeq } = generation;
  useEffect(() => {
    if (!editor || editor.isDestroyed || !streaming.active || !streamingBlock) return;
    if (Date.now() - userScrolledAt.current < 5000) return;
    const entry = findBlockEntry(editor.state.doc, streamingBlock);
    const node = entry ? editor.view.nodeDOM(entry.pos) : null;
    if (node && 'scrollIntoView' in node) (node as Element).scrollIntoView({ block: 'nearest' });
  }, [editor, streaming.active, streamingBlock, streamSeq]);
  /** The person placed the caret in the text at least once (quotes go there, else at the end). */
  const caretPlaced = useRef(false);
  useEffect(() => {
    if (!editor) return undefined;
    const onFocus = () => {
      caretPlaced.current = true;
    };
    editor.on('focus', onFocus);
    return () => {
      editor.off('focus', onFocus);
    };
  }, [editor]);
  const caretWasPlaced = useCallback(() => caretPlaced.current, []);
  /** Selection read when an action runs (no re-render of the whole studio per caret move). */
  const currentSelection = useCallback((): SelectionInfo => (editor && !editor.isDestroyed ? selectionInfo(editor.state) : EMPTY_SELECTION_INFO), [editor]);

  // The body on screen after a stream ends (the editor emits no change for streamed text).
  useRunListener(generation.runId, (update) => {
    const type = update.event.type;
    if (type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled' || type === 'block.completed') {
      queueMicrotask(() => {
        const current = handle.getBody();
        if (current) setBody(current);
      });
    }
  });

  // ——— External changes to the draft (generation settled, restore, another tab) ———
  const expectReload = useRef(false);
  /** The next draft change from the store replaces the text on screen (a decision or a restore). */
  const awaitReload = useCallback((expected: boolean) => {
    expectReload.current = expected;
  }, []);
  useEffect(() => {
    if (!editor || editor.isDestroyed || streaming.active) return;
    if (draft.revision === sync.base() || sync.busy()) return;
    const stored = draft.body as ArticleBody;
    const current = handle.getBody();
    if (!current) return;
    const storeHash = bodyHash(stored);
    if (bodyHash({ ...current, title: stored.title }) === storeHash) {
      sync.adopt(draft.revision, stored);
      return;
    }
    if (expectReload.current || bodyHash(current) === sync.syncedHash()) {
      expectReload.current = false;
      setArticleBody(editor, stored);
      sync.adopt(draft.revision, stored);
      queueMicrotask(() => setBody(stored));
      return;
    }
    // Edits on top of an external change: the text on screen wins and is saved next.
    sync.adopt(draft.revision);
    handle.flush();
  }, [draft.revision, draft.body, editor, handle, streaming.active, sync]);

  const scrollToBlock = useCallback(
    (blockId: BlockId) => {
      if (!editor || editor.isDestroyed) return;
      const entry = findBlockEntry(editor.state.doc, blockId);
      if (!entry) return;
      const node = editor.view.nodeDOM(entry.pos);
      if (node && 'scrollIntoView' in node) (node as Element).scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [editor],
  );

  /**
   * A jump in the text: the block rises to the upper third of the pane and, with `caret`, the caret
   * goes to the start of the block (or to the end of a passage) without the editor's own scroll.
   */
  const revealBlock = useCallback(
    (blockId: BlockId, options: { caret?: 'start' | TextRange } = {}) => {
      if (!editor || editor.isDestroyed) return;
      const { caret } = options;
      if (caret === 'start') focusBlock(editor, blockId, { scroll: false });
      else if (caret) {
        const positions = textRangeToPositions(editor.state.doc, caret);
        if (positions) editor.chain().setTextSelection(positions.to).focus(null, { scrollIntoView: false }).run();
      }
      const entry = findBlockEntry(editor.state.doc, blockId);
      const node = entry ? editor.view.nodeDOM(entry.pos) : null;
      if (node instanceof Element) revealInUpperThird(node);
    },
    [editor],
  );

  /** Pending edits saved and the text on screen, with the title, against the last known revision. */
  const prepare = useCallback(async (): Promise<{ body: ArticleBody; baseRevision: number } | null> => {
    handle.flush();
    await sync.idle();
    const current = handle.getBody();
    return current ? { body: { ...current, title }, baseRevision: sync.base() } : null;
  }, [handle, sync, title]);

  const commitTitle = useCallback(
    (value: string) => {
      setLocalTitle(value);
      const current = handle.getBody();
      if (current) void sync.save({ ...current, title: value });
    },
    [handle, sync],
  );

  return {
    sync,
    body,
    title,
    storedTitle,
    setLocalTitle,
    commitTitle,
    images,
    handle,
    editor,
    streaming,
    noteUserScroll,
    caretWasPlaced,
    currentSelection,
    awaitReload,
    scrollToBlock,
    revealBlock,
    readOnly,
    prepare,
  };
}

export type StudioText = ReturnType<typeof useStudioText>;
