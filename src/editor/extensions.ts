import { Extension, Node, getSchema, mergeAttributes, textblockTypeInputRule } from '@tiptap/react';
import type { AnyExtension, Editor } from '@tiptap/react';
import type { Schema } from '@tiptap/pm/model';
import { Placeholder } from '@tiptap/extension-placeholder';
import { StarterKit } from '@tiptap/starter-kit';
import { isSafeLink } from '../domain/index.ts';
import { blockIdsPlugin, createBlockIdFactory, ensureBlockIds } from './block-ids.ts';
import type { BlockIdFactory } from './block-ids.ts';
import { articleDecorationsPlugin } from './decorations.ts';
import type { ArticleWidgetHandlers, ProseWidgetFactory } from './decorations.ts';
import { figureDOMSpec, figureSourcesPlugin, parseFigureElement } from './figures.ts';
import { imageInputPlugin } from './image-input.ts';
import type { ImageInputOptions } from './image-input.ts';
import { BLOCK_ATTR, DATA_ATTR, DOC_ATTR, FIGURE_ATTR, HEADING_LEVELS, NODE, TOP_BLOCK_TYPES } from './schema.ts';
import { streamPlugin } from './streaming.ts';

/**
 * TipTap configuration of the article: logic only. Styling comes from the Design System `Prose`
 * (the `EditorContent` goes inside it) through plain HTML and `data-*` hooks; there are no node
 * views and no local CSS.
 */

export type PlaceholderTexts = {
  /** Empty document. A function is read on every redraw (e.g. silent while a first draft is being written). */
  document: string | (() => string);
  paragraph: string;
  heading2: string;
  heading3: string;
  quote: string;
};

export const DEFAULT_PLACEHOLDERS: PlaceholderTexts = {
  document: 'Comece a escrever ou gere um rascunho',
  paragraph: 'Continue o texto',
  heading2: 'Intertítulo',
  heading3: 'Subtítulo',
  quote: 'Citação',
};

export type ArticleExtensionsOptions = ImageInputOptions & {
  /** `false` for read-only previews. */
  placeholder?: Partial<PlaceholderTexts> | false;
  newBlockId?: BlockIdFactory;
  /** Screen-reader description of an unreviewed AI block. */
  aiDescription?: string;
  /**
   * The Design System `proseWidgets` (proposal insertions, the AI gutter marker). Read once;
   * handlers go through `setArticleWidgetHandlers`.
   */
  widgets?: ProseWidgetFactory;
};

/** Quote as a textblock (domain `QuoteBlock` has inlines only): `<blockquote><p>…</p></blockquote>`. */
export const QuoteNode = Node.create({
  name: NODE.quote,
  group: 'block',
  content: 'inline*',
  defining: true,
  parseHTML() {
    return [{ tag: 'blockquote' }, { tag: 'p', context: `${NODE.quote}/`, skip: true, priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['blockquote', mergeAttributes(HTMLAttributes), ['p', 0]];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-b': () => this.editor.commands.toggleNode(this.name, NODE.paragraph) };
  },
  addInputRules() {
    return [textblockTypeInputRule({ find: /^\s*>\s$/, type: this.type })];
  },
});

/** One paragraph per item and no nesting (domain `ListBlock.items: Inline[][]`). Tab leaves the editor. */
export const ListItemNode = Node.create({
  name: NODE.listItem,
  content: NODE.paragraph,
  defining: true,
  parseHTML() {
    return [{ tag: 'li' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['li', mergeAttributes(HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    };
  },
});

/**
 * An image block (domain `FigureBlock`): an atom, selected and changed as a whole (alt, caption
 * and credit are edited outside the text). Plain HTML for `Prose`: `figure > img + figcaption`.
 * Pasted figures and images are parsed (see `parseFigureElement`); no node view.
 */
export const FigureNode = Node.create({
  name: NODE.figure,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    // Read by the parse rules below, never from same-named HTML attributes; rendered by `figureDOMSpec`.
    const attribute = { default: null, rendered: false, keepOnSplit: false, parseHTML: () => null };
    return Object.fromEntries(Object.values(FIGURE_ATTR).map((name) => [name, { ...attribute }]));
  },
  parseHTML() {
    return [
      { tag: 'figure', getAttrs: (element) => parseFigureElement(element) },
      { tag: 'img[src]', getAttrs: (element) => parseFigureElement(element) },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return figureDOMSpec(node.attrs, HTMLAttributes);
  },
});

type ArticleBlocksOptions = {
  newBlockId: BlockIdFactory;
  aiDescription: string | undefined;
  imageInput: ImageInputOptions;
  widgets: ProseWidgetFactory | undefined;
};
type ArticleBlocksStorage = { imageInput: ImageInputOptions; widgetHandlers: ArticleWidgetHandlers };

/** Block attributes (`blockId` → `data-block-id`, `sourceRefs`, `ai`), the cover and the article plugins. */
export const ArticleBlocks = Extension.create<ArticleBlocksOptions, ArticleBlocksStorage>({
  name: 'reporterArticleBlocks',
  addOptions() {
    return { newBlockId: createBlockIdFactory(), aiDescription: undefined, imageInput: {}, widgets: undefined };
  },
  addStorage() {
    return { imageInput: this.options.imageInput, widgetHandlers: {} };
  },
  addGlobalAttributes() {
    return [
      {
        types: [...TOP_BLOCK_TYPES],
        attributes: {
          [BLOCK_ATTR.id]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute(DATA_ATTR.blockId),
            renderHTML: (attributes) => (attributes[BLOCK_ATTR.id] ? { [DATA_ATTR.blockId]: attributes[BLOCK_ATTR.id] } : {}),
          },
          [BLOCK_ATTR.sourceRefs]: { default: null, keepOnSplit: false, rendered: false },
          [BLOCK_ATTR.ai]: { default: null, keepOnSplit: false, rendered: false },
        },
      },
      {
        // The cover (`ArticleBody.cover`): body metadata kept with the text, so it saves and undoes with it.
        types: [NODE.doc],
        attributes: { [DOC_ATTR.cover]: { default: null, rendered: false, parseHTML: () => null } },
      },
    ];
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      blockIdsPlugin({ newId: this.options.newBlockId }),
      articleDecorationsPlugin({ aiDescription: this.options.aiDescription, widgets: this.options.widgets, handlers: () => storage.widgetHandlers }),
      streamPlugin(),
      figureSourcesPlugin(),
      imageInputPlugin(() => storage.imageInput),
    ];
  },
  onCreate() {
    const tr = ensureBlockIds(this.editor.state, this.options.newBlockId);
    if (tr) this.editor.view.dispatch(tr);
  },
});

function blocksStorage(editor: Editor): ArticleBlocksStorage | undefined {
  return (editor.storage as unknown as Record<string, ArticleBlocksStorage | undefined>)[ArticleBlocks.name];
}

/** Swaps the paste/drop image handlers of a live editor (read on every event). */
export function setImageInputHandlers(editor: Editor, handlers: ImageInputOptions): void {
  const storage = blocksStorage(editor);
  if (storage) storage.imageInput = handlers;
}

/** Swaps what the Design System widgets do when used (the AI marker's click), read at that moment. */
export function setArticleWidgetHandlers(editor: Editor, handlers: ArticleWidgetHandlers): void {
  const storage = blocksStorage(editor);
  if (storage) storage.widgetHandlers = handlers;
}

/**
 * Keys the article claims before StarterKit: ⌘↵ decides the AI suggestion (the studio listens for
 * it), so the hard break's `Mod-Enter` is off — a line break stays on Shift-Enter. Without a
 * suggestion to decide, ⌘↵ does nothing (it never corrupts a suggestion with a line break).
 */
export const ArticleKeymap = Extension.create({
  name: 'reporterArticleKeymap',
  priority: 1000,
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => true };
  },
});

function placeholderExtension(texts: PlaceholderTexts): AnyExtension {
  return Placeholder.configure({
    showOnlyCurrent: true,
    includeChildren: false,
    placeholder: ({ editor, node }) => {
      if (editor.isEmpty) return typeof texts.document === 'function' ? texts.document() : texts.document;
      if (node.type.name === NODE.heading) return node.attrs.level === 3 ? texts.heading3 : texts.heading2;
      if (node.type.name === NODE.quote) return texts.quote;
      return texts.paragraph;
    },
  });
}

/** The article schema and behaviour. Create once per editor (e.g. `useState(() => articleExtensions())`). */
export function articleExtensions(options: ArticleExtensionsOptions = {}): AnyExtension[] {
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      blockquote: false,
      listItem: false,
      code: false,
      codeBlock: false,
      heading: { levels: [...HEADING_LEVELS] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        isAllowedUri: (url) => isSafeLink(url),
        shouldAutoLink: (url) => isSafeLink(url),
      },
    }),
    ArticleKeymap,
    QuoteNode,
    ListItemNode,
    FigureNode,
    ArticleBlocks.configure({
      newBlockId: options.newBlockId ?? createBlockIdFactory(),
      aiDescription: options.aiDescription,
      widgets: options.widgets,
      imageInput: {
        onImageFiles: options.onImageFiles,
        onForeignImages: options.onForeignImages,
        onRejectedFiles: options.onRejectedFiles,
        onFigureCaption: options.onFigureCaption,
      },
    }),
  ];
  if (options.placeholder !== false) extensions.push(placeholderExtension({ ...DEFAULT_PLACEHOLDERS, ...options.placeholder }));
  return extensions;
}

let cachedSchema: Schema | undefined;

/** The article ProseMirror schema (for converters, tests and headless transforms). */
export function articleSchema(): Schema {
  cachedSchema ??= getSchema(articleExtensions({ placeholder: false }));
  return cachedSchema;
}
