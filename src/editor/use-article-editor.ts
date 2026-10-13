'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { isImageSlot } from '../domain/index.ts';
import type { ArticleBody, BlockId, ImageRef, RunId, Suggestion } from '../domain/index.ts';
import { useRun, useRunListener } from '../state/index.ts';
import { createBlockIdFactory } from './block-ids.ts';
import { blockKindAt, setFigureSources } from './commands.ts';
import type { BlockKind } from './commands.ts';
import type { ProseWidgetFactory } from './decorations.ts';
import { articleExtensions, setArticleWidgetHandlers, setImageInputHandlers } from './extensions.ts';
import type { PlaceholderTexts } from './extensions.ts';
import { coverOf, figureAt, figureRect, figureSourcesOf, imageSlotAt, imageSlotsIn } from './figures.ts';
import type { FigureInfo, ImageSlotInfo } from './figures.ts';
import type { ForeignImagesHandler, ImageFilesHandler, SlotFilesHandler } from './image-input.ts';
import { docBody } from './nodes.ts';
import { articleToDoc } from './pm-json.ts';
import type { FigureSources } from './pm-json.ts';
import { selectionInfo, selectionRect, EMPTY_SELECTION_INFO } from './selection.ts';
import type { SelectionInfo } from './selection.ts';
import { applyRunUpdateToEditor, isStreaming, streamKey, streamState, syncRunSnapshotInEditor } from './streaming.ts';
import type { StreamMeta, StreamMode } from './streaming.ts';
import { isSuggestionStaleInDoc } from './suggestions.ts';
import { MARK } from './schema.ts';

/** The TipTap view to place inside the Design System `Prose` (`<Prose><EditorContent editor={editor} /></Prose>`). */
export { EditorContent } from '@tiptap/react';
export type { Editor } from '@tiptap/react';

/**
 * React bindings. The editor never re-renders React per transaction
 * (`shouldRerenderOnTransaction: false`); components subscribe to the slice they show through
 * `useEditorState` selectors. `onChange` is debounced and serialises the document only when it
 * fires, never per keystroke. While a generation streams, changes wait for the stream to end
 * (the run owns generated text; see `streaming.ts`).
 */

export type UseArticleEditorOptions = {
  /** Read once, when the editor is created. Remount (React `key`) to open another body. */
  initialBody: ArticleBody;
  /** Latest title, copied into the body handed to `onChange` (the title is edited outside). */
  title?: string;
  readOnly?: boolean;
  /**
   * Debounced; `revision` counts the person's document changes in this editor instance (it is
   * not the draft revision of the store).
   */
  onChange?: (body: ArticleBody, revision: number) => void;
  /** Default 600 ms. */
  debounceMs?: number;
  /** Accessible name of the text area. */
  label?: string;
  placeholder?: Partial<PlaceholderTexts> | false;
  /**
   * What the figures show per asset (object URL or link, credit, size); keep it memoised. Display
   * only: never in the body, the history or `onChange`.
   */
  figureSources?: FigureSources;
  /** Image files pasted or dropped (validate, store, then `insertFigure(editor, image, placement)`). */
  onImageFiles?: ImageFilesHandler;
  /** Image files dropped on an open image slot, or pasted while it is selected: fill that slot. */
  onSlotFiles?: SlotFilesHandler;
  /**
   * Images from another page pasted as HTML (adopt: `updateFigure(…, { assetId }, { history: false })`).
   * Without it, such images are left out of the paste.
   */
  onForeignImages?: ForeignImagesHandler;
  /** Files dropped that are not images (nothing was inserted). */
  onRejectedFiles?: (files: File[]) => void;
  /** A click on a figure's caption: open "Legenda e crédito" on the caption. */
  onFigureCaption?: (blockId: BlockId) => void;
  /** Enter on a selected image slot: choose its image. */
  onSlotOpen?: (blockId: BlockId) => void;
  /**
   * The Design System `proseWidgets` (the proposal read in the paragraph, the AI gutter marker).
   * Read once, when the editor is created.
   */
  widgets?: ProseWidgetFactory;
  /** The AI gutter marker of a block was clicked (a passive cue unless the host handles it). */
  onAiMarker?: (blockId: BlockId) => void;
  /**
   * The selection landed on an image slot (a click, the keyboard or a jump from "Imagens
   * sugeridas"): offer "Escolher imagem" / "Dispensar". Called once per slot reached.
   */
  onImageSlotSelect?: (slot: ImageSlotInfo) => void;
};

export type ArticleEditorHandle = {
  editor: Editor | null;
  /** Emits a pending change now (before `decideSuggestion`, ⌘S, leaving the page). */
  flush: () => void;
  /** Current body, serialised on demand. */
  getBody: () => ArticleBody | null;
};

const DEFAULT_DEBOUNCE_MS = 600;

export function useArticleEditor(options: UseArticleEditorOptions): ArticleEditorHandle {
  const { initialBody, readOnly = false, debounceMs = DEFAULT_DEBOUNCE_MS, label = 'Texto do artigo', figureSources } = options;
  const [setup] = useState(() => {
    const newBlockId = createBlockIdFactory();
    return {
      extensions: articleExtensions({ newBlockId, placeholder: options.placeholder, widgets: options.widgets }),
      content: articleToDoc(initialBody, { emptyBlockId: initialBody.blocks.length === 0 ? newBlockId() : undefined, figureSources }),
    };
  });
  const latest = useRef({ onChange: options.onChange, title: options.title ?? initialBody.title, readOnly });
  useEffect(() => {
    latest.current = { onChange: options.onChange, title: options.title ?? initialBody.title, readOnly };
  });
  const flushRef = useRef<() => void>(() => undefined);

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    extensions: setup.extensions,
    content: setup.content,
    editable: !readOnly,
    editorProps: {
      // A function, so `aria-readonly` follows `readOnly` when the view updates.
      attributes: () => ({
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'aria-readonly': String(latest.current.readOnly),
        lang: 'pt-BR',
        spellcheck: 'true',
      }),
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  useFigureSources(editor, figureSources);
  const { onImageFiles, onSlotFiles, onForeignImages, onRejectedFiles, onFigureCaption, onSlotOpen } = options;
  useEffect(() => {
    if (editor && !editor.isDestroyed) setImageInputHandlers(editor, { onImageFiles, onSlotFiles, onForeignImages, onRejectedFiles, onFigureCaption, onSlotOpen });
  }, [editor, onImageFiles, onSlotFiles, onForeignImages, onRejectedFiles, onFigureCaption, onSlotOpen]);
  const { onAiMarker } = options;
  useEffect(() => {
    // Only when given: a host may set the handlers itself (`setArticleWidgetHandlers`).
    if (editor && !editor.isDestroyed && onAiMarker) setArticleWidgetHandlers(editor, { onAiMarker });
  }, [editor, onAiMarker]);
  useImageSlotSelect(editor, options.onImageSlotSelect);

  useEffect(() => {
    if (!editor) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending = false;
    let revision = 0;

    const emit = () => {
      timer = undefined;
      if (!pending || editor.isDestroyed || isStreaming(editor.state)) return;
      pending = false;
      const { onChange, title } = latest.current;
      onChange?.(docBody(editor.state.doc, { title }), revision);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(emit, debounceMs);
    };
    const flush = () => {
      if (timer) clearTimeout(timer);
      emit();
    };
    const onUpdate = () => {
      revision += 1;
      pending = true;
      schedule();
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const meta = transaction.getMeta(streamKey) as StreamMeta | undefined;
      if (meta?.type === 'end' && pending) schedule();
    };
    const onPageHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    flushRef.current = flush;
    editor.on('update', onUpdate);
    editor.on('transaction', onTransaction);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      editor.off('update', onUpdate);
      editor.off('transaction', onTransaction);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
      flushRef.current = () => undefined;
    };
  }, [editor, debounceMs]);

  const flush = useCallback(() => flushRef.current(), []);
  const getBody = useCallback(() => (editor ? docBody(editor.state.doc, { title: latest.current.title }) : null), [editor]);
  return useMemo(() => ({ editor, flush, getBody }), [editor, flush, getBody]);
}

export type UseArticleReaderOptions = {
  body: Pick<ArticleBody, 'blocks' | 'cover' | 'coverSlot'>;
  /** What the figures show per asset (keep it memoised). */
  figureSources?: FigureSources;
  /** Leave the open image slots out (the publishable text, as the exports show it). */
  hideImageSlots?: boolean;
};

/** Calls `onSelect` when the selection reaches an image slot (once per slot reached). */
function useImageSlotSelect(editor: Editor | null, onSelect: ((slot: ImageSlotInfo) => void) | undefined): void {
  const latest = useRef(onSelect);
  useEffect(() => {
    latest.current = onSelect;
  });
  useEffect(() => {
    if (!editor || !onSelect) return undefined;
    let last: BlockId | null = null;
    const onSelection = () => {
      if (editor.isDestroyed) return;
      const slot = imageSlotAt(editor.state.selection);
      const id = slot?.blockId ?? null;
      if (id === last) return;
      last = id;
      if (slot) latest.current?.(slot);
    };
    editor.on('selectionUpdate', onSelection);
    return () => {
      editor.off('selectionUpdate', onSelection);
    };
  }, [editor, onSelect]);
}

/** The body without open slots or the cover suggestion (what `hideImageSlots` shows). */
function publishableView(body: Pick<ArticleBody, 'blocks' | 'cover' | 'coverSlot'>): Pick<ArticleBody, 'blocks' | 'cover'> {
  const view: Pick<ArticleBody, 'blocks' | 'cover'> = { blocks: body.blocks.filter((block) => !isImageSlot(block)) };
  if (body.cover) view.cover = body.cover;
  return view;
}

/** Applies display data to the figures whenever the map changes. */
function useFigureSources(editor: Editor | null, figureSources: FigureSources | undefined): void {
  useEffect(() => {
    if (!editor || editor.isDestroyed || !figureSources || figureSourcesOf(editor.state) === figureSources) return;
    setFigureSources(editor, figureSources);
  }, [editor, figureSources]);
}

/**
 * Read-only article (review, material and version previews) with the same schema and `data-*`
 * hooks, figures included. A new `body` object replaces the content outside any history.
 */
export function useArticleReader({ body, figureSources, hideImageSlots = false }: UseArticleReaderOptions): Editor | null {
  const [setup] = useState(() => ({
    extensions: articleExtensions({ placeholder: false }),
    content: articleToDoc(hideImageSlots ? publishableView(body) : body, { figureSources }),
  }));
  const shown = useRef(body);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editable: false,
    extensions: setup.extensions,
    content: setup.content,
    editorProps: { attributes: { lang: 'pt-BR', 'aria-readonly': 'true' } },
  });
  useEffect(() => {
    if (!editor || shown.current === body) return;
    shown.current = body;
    editor.commands.setContent(articleToDoc(hideImageSlots ? publishableView(body) : body), { emitUpdate: false });
  }, [editor, body, hideImageSlots]);
  useFigureSources(editor, figureSources);
  return editor;
}

/**
 * Streams a generation run into the editor: the attach snapshot once per run, then every live
 * update (`useRunListener`). `mode: 'replace'` only for a run this screen just started
 * ("Gerar nova versão"). The host re-renders on each run update (it reads `useRun`); keep it in
 * the component that already shows the run's progress.
 */
export function useEditorRunStream(editor: Editor | null, runId: RunId | null | undefined, options: { mode?: StreamMode } = {}): void {
  const { mode } = options;
  const run = useRun(runId);
  const fold = run.status === 'ready' ? run.data?.fold : undefined;
  const synced = useRef<{ editor: Editor; runId: RunId } | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !runId || !fold || fold.run.id !== runId) return;
    if (synced.current?.editor === editor && synced.current.runId === runId) return;
    synced.current = { editor, runId };
    syncRunSnapshotInEditor(editor.view, fold, { mode });
  }, [editor, runId, fold, mode]);
  useRunListener(runId, (update) => {
    if (editor && !editor.isDestroyed) applyRunUpdateToEditor(editor.view, update, { mode });
  });
}

// ——— Selectors ———

export type ArticleToolbarState = {
  ready: boolean;
  editable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  link: boolean;
  /** Address of the link under the selection. */
  href: string | null;
  block: BlockKind | 'divider' | 'figure' | null;
  selectionEmpty: boolean;
  /** A generation is writing into the document. */
  streaming: boolean;
};

export const EMPTY_TOOLBAR_STATE: ArticleToolbarState = {
  ready: false,
  editable: false,
  canUndo: false,
  canRedo: false,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  link: false,
  href: null,
  block: null,
  selectionEmpty: true,
  streaming: false,
};

export function readToolbarState(editor: Editor): ArticleToolbarState {
  const { state } = editor;
  const href = editor.getAttributes(MARK.link).href;
  return {
    ready: true,
    editable: editor.isEditable,
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    bold: editor.isActive(MARK.bold),
    italic: editor.isActive(MARK.italic),
    underline: editor.isActive(MARK.underline),
    strike: editor.isActive(MARK.strike),
    link: editor.isActive(MARK.link),
    href: typeof href === 'string' ? href : null,
    block: blockKindAt(state),
    selectionEmpty: state.selection.empty,
    streaming: isStreaming(state),
  };
}

/** Toolbar state (active marks, block style, undo/redo); re-renders only when it changes. */
export function useArticleToolbarState(editor: Editor | null): ArticleToolbarState {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? readToolbarState(current) : EMPTY_TOOLBAR_STATE),
    }) ?? EMPTY_TOOLBAR_STATE
  );
}

/** Selection facts for the floating toolbar and the copilot chip ("Seleção · §3"). */
export function useSelectionInfo(editor: Editor | null): SelectionInfo {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => (current ? selectionInfo(current.state) : EMPTY_SELECTION_INFO),
    }) ?? EMPTY_SELECTION_INFO
  );
}

/** `anchor` for the Design System `FloatingToolbar`: the selected text's rectangle. */
export function useSelectionAnchor(editor: Editor | null): () => DOMRect | null {
  return useCallback(() => (editor && !editor.isDestroyed ? selectionRect(editor.view) : null), [editor]);
}

/** The selected image (clicked, or reached by "Imagens com crédito"), for the image toolbar. */
export function useSelectedFigure(editor: Editor | null): FigureInfo | null {
  return useEditorState({ editor, selector: ({ editor: current }) => (current ? figureAt(current.state.selection) : null) }) ?? null;
}

/** `anchor` for the Design System `FloatingToolbar` of an image: the figure's rectangle. */
export function useFigureAnchor(editor: Editor | null, blockId: BlockId | null | undefined): () => DOMRect | null {
  return useCallback(() => (editor && !editor.isDestroyed && blockId ? figureRect(editor.view, blockId) : null), [editor, blockId]);
}

/** The cover the document holds now (set with `setArticleCover`). */
export function useArticleCover(editor: Editor | null): ImageRef | null {
  return useEditorState({ editor, selector: ({ editor: current }) => (current ? coverOf(current.state.doc) : null) }) ?? null;
}

/** The selected image slot (clicked, or reached by "Imagens sugeridas"), for "Escolher imagem" / "Dispensar". */
export function useSelectedImageSlot(editor: Editor | null): ImageSlotInfo | null {
  return useEditorState({ editor, selector: ({ editor: current }) => (current ? imageSlotAt(current.state.selection) : null) }) ?? null;
}

const NO_SLOTS: ImageSlotInfo[] = [];

/** Open image slots of the document in reading order (the cover suggestion first). */
export function useImageSlots(editor: Editor | null): ImageSlotInfo[] {
  return useEditorState({ editor, selector: ({ editor: current }) => (current ? imageSlotsIn(current.state.doc) : NO_SLOTS) }) ?? NO_SLOTS;
}

export type StreamingInfo = { active: boolean; runId: string | null; blockIds: readonly BlockId[]; edited: boolean };

const IDLE_INFO: StreamingInfo = { active: false, runId: null, blockIds: [], edited: false };

export function useStreamingInfo(editor: Editor | null): StreamingInfo {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) => {
        if (!current) return IDLE_INFO;
        const state = streamState(current.state);
        return { active: state.runId !== null, runId: state.runId, blockIds: state.inFlight, edited: state.edited };
      },
    }) ?? IDLE_INFO
  );
}

/** Ids of pending suggestions whose target changed in the live text ("Trecho mudou · Reaplicar"). */
export function useStaleSuggestionIds(editor: Editor | null, suggestions: readonly Suggestion[]): string[] {
  return (
    useEditorState({
      editor,
      selector: ({ editor: current }) =>
        current
          ? suggestions
              .filter((suggestion) => suggestion.state === 'ready' && isSuggestionStaleInDoc(current.state.doc, suggestion))
              .map((suggestion) => suggestion.id)
          : [],
    }) ?? []
  );
}
