import { history } from '@tiptap/pm/history';
import { EditorState } from '@tiptap/pm/state';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import { dividerBlock, figureBlock, headingBlock, listBlock, paragraphBlock, quoteBlock, segmentRef, stampRunEvent } from '../domain/index.ts';
import type { ArticleBody, RunEvent, RunEventPayload, SourceRef } from '../domain/index.ts';
import { blockIdsPlugin, createBlockIdFactory } from './block-ids.ts';
import { articleDecorationsPlugin } from './decorations.ts';
import type { ArticleDecorationsOptions } from './decorations.ts';
import { articleSchema } from './extensions.ts';
import { figureSourcesPlugin } from './figures.ts';
import { articleDocNode } from './nodes.ts';
import { streamPlugin } from './streaming.ts';
import type { ViewLike } from './view.ts';

/**
 * Headless helpers for the editor tests: the real article schema and plugins on a bare
 * ProseMirror `EditorState` (no DOM, no TipTap editor instance). Not part of the public API.
 */

export const REF_A: SourceRef = segmentRef('src-1', 1, 'seg-3', { from: 0, to: 24 });
export const REF_B: SourceRef = segmentRef('src-1', 1, 'seg-7');

/** Every block type, mark, link, hard break, source refs and AI states. */
export const RICH_BODY: ArticleBody = {
  type: 'article',
  title: 'Ateliê Sul',
  blocks: [
    paragraphBlock(
      'b1',
      [
        { text: 'Abertura com ' },
        { text: 'negrito', marks: ['bold'] },
        { text: ' e ' },
        { text: 'link', marks: ['italic', 'link'], href: 'https://example.com/materia' },
        { text: '\nlinha nova', marks: ['underline'] },
      ],
      { ai: 'unreviewed', sourceRefs: [REF_A] },
    ),
    headingBlock('b2', 'Como tudo começou', 2, { ai: 'unreviewed' }),
    headingBlock('b3', 'Primeiros clientes', 3, { ai: 'reviewed' }),
    quoteBlock('b4', '“A gente começou pequeno, numa garagem”', { sourceRefs: [REF_A, REF_B] }),
    listBlock('b5', ['um', 'dois', 'três'], true),
    { id: 'b6', type: 'list', ordered: false, items: [[{ text: 'riscado', marks: ['strike'] }], [{ text: 'b' }, { text: 'c', marks: ['bold'] }]] },
    dividerBlock('b7'),
    paragraphBlock('b8', 'Fecho.'),
  ],
};

/** Cover, figures (with and without caption/alt, AI-reviewed with sources) between text blocks. */
export const FIGURE_BODY: ArticleBody = {
  type: 'article',
  title: 'Ateliê Sul em imagens',
  cover: { assetId: 'ast-capa', alt: 'Fachada do ateliê', caption: 'O ateliê na Rua Augusta' },
  blocks: [
    paragraphBlock('p1', 'Abertura do texto.'),
    figureBlock('f1', { assetId: 'ast-1', alt: 'Ana na bancada', caption: 'Ana Prado corta o couro' }, { ai: 'unreviewed', sourceRefs: [REF_A] }),
    paragraphBlock('p2', 'Segundo parágrafo.'),
    figureBlock('f2', { assetId: 'ast-2' }),
    headingBlock('h1', 'Depois', 2),
    paragraphBlock('p3', 'Fecho.'),
  ],
};

export type StateOptions = { history?: boolean; extraPlugins?: Plugin[]; salt?: string; decorations?: ArticleDecorationsOptions };

export function articleState(body: Pick<ArticleBody, 'blocks' | 'cover'>, options: StateOptions = {}): EditorState {
  const schema = articleSchema();
  const plugins: Plugin[] = [
    ...(options.history ? [history()] : []),
    blockIdsPlugin({ newId: createBlockIdFactory({ salt: options.salt ?? 'test01' }) }),
    articleDecorationsPlugin(options.decorations),
    streamPlugin(),
    figureSourcesPlugin(),
    ...(options.extraPlugins ?? []),
  ];
  return EditorState.create({ schema, doc: articleDocNode(schema, body), plugins });
}

export type TestView = ViewLike & { dispatched: Transaction[] };

/** A view double: `dispatch` applies the transaction (filters and appended transactions included). */
export function testView(state: EditorState): TestView {
  const view: TestView = {
    state,
    dispatched: [],
    dispatch(tr) {
      view.dispatched.push(tr);
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

/** Stamps payloads as one run's event log (seq 1…n, one second apart). */
export function runEvents(runId: string, payloads: readonly RunEventPayload[]): RunEvent[] {
  return payloads.map((payload, index) => stampRunEvent(payload, runId, index + 1, new Date(Date.UTC(2026, 9, 7, 12, 0, index)).toISOString()));
}
