import type { EditorState, Transaction } from '@tiptap/pm/state';

/** What the helpers need from a view: TipTap's `editor.view`, or a test double over `EditorState`. */
export type ViewLike = { state: EditorState; dispatch: (tr: Transaction) => void };
