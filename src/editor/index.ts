/**
 * Reporter article editor: TipTap as logic only. The studio renders `EditorContent` inside the
 * Design System `Prose`; everything visual is a `data-*` hook on plain HTML.
 */

export * from './schema.ts';
export * from './pm-json.ts';
export * from './nodes.ts';
export * from './ranges.ts';
export * from './block-ids.ts';
export {
  articleDecorationsKey,
  articleDecorationsPlugin,
  articleDecorationInput,
  buildArticleDecorations,
  setArticleDecorations,
  withArticleDecorations,
  EMPTY_DECORATION_INPUT,
} from './decorations.ts';
export type {
  ArticleDecorationInput,
  ArticleDecorationPatch,
  ArticleDecorationsOptions,
  ArticleDecorationsState,
  ArticleWidgetHandlers,
  ProseWidgetFactory,
  QuoteDecoration,
  QuoteSourceState,
  SuggestionDecoration,
  SuggestionInsertion,
} from './decorations.ts';
export {
  applyRunUpdateToEditor,
  endStreamTransaction,
  isStreaming,
  isStreamTransaction,
  settleRunInEditor,
  streamedBlock,
  streamingBlockIds,
  streamKey,
  streamPlugin,
  streamState,
  streamTransaction,
  syncRunSnapshotInEditor,
  touchesBlocks,
  IDLE_STREAM,
} from './streaming.ts';
export type { RunUpdateLike, StreamMeta, StreamMode, StreamState, StreamSyncOptions } from './streaming.ts';
export type { ViewLike } from './view.ts';
export {
  applySuggestionInEditor,
  isSuggestionStaleInDoc,
  locateSuggestionInDoc,
  suggestionAtCaret,
  suggestionDecorations,
  suggestionTransaction,
  SUGGESTION_META,
} from './suggestions.ts';
export type { SuggestionTransactionRefusal } from './suggestions.ts';
export * from './selection.ts';
export * from './figures.ts';
export * from './image-input.ts';
export * from './extensions.ts';
export * from './commands.ts';
export * from './use-article-editor.ts';
