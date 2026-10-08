/**
 * Names shared by the TipTap schema, the converters and the plugins. The article schema is the
 * domain `ArticleBody` and nothing more: paragraph, heading 2|3, quote (a textblock), bullet and
 * ordered lists with one paragraph per item (no nesting), divider, figure (an image block, atom),
 * hard break, B/I/U/S and link. No code, highlight, text style, alignment or inline image.
 * The cover (`ArticleBody.cover`) is not a node: it is a document attribute.
 */

export const NODE = {
  doc: 'doc',
  paragraph: 'paragraph',
  heading: 'heading',
  quote: 'blockquote',
  bulletList: 'bulletList',
  orderedList: 'orderedList',
  listItem: 'listItem',
  divider: 'horizontalRule',
  figure: 'figure',
  hardBreak: 'hardBreak',
  text: 'text',
} as const;

export const MARK = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strike',
  link: 'link',
} as const;

/** Node attributes every top-level block carries (domain `BlockBase`). */
export const BLOCK_ATTR = {
  id: 'blockId',
  sourceRefs: 'sourceRefs',
  ai: 'ai',
} as const;

/**
 * Figure attributes. `assetId`, `alt` and `caption` are the domain `ImageRef`; `slot` is the domain
 * `ImageSlot` of a figure planned by the generation that has no image yet; `credit`, `src`,
 * `width` and `height` are display only (synced from the asset, never persisted).
 */
export const FIGURE_ATTR = {
  assetId: 'assetId',
  alt: 'alt',
  caption: 'caption',
  slot: 'slot',
  credit: 'credit',
  src: 'src',
  width: 'width',
  height: 'height',
} as const;

/** Figure attributes that only drive what the editor shows (never in the domain body). */
export const FIGURE_DISPLAY_ATTRS = [FIGURE_ATTR.credit, FIGURE_ATTR.src, FIGURE_ATTR.width, FIGURE_ATTR.height] as const;

/** Document attributes (body metadata kept with the text, outside any node). */
export const DOC_ATTR = {
  cover: 'cover',
  /** The generation's suggestion for the cover (`ArticleBody.coverSlot`), while there is no cover. */
  coverSlot: 'coverSlot',
} as const;

/** Top-level block node types; each one carries the `BLOCK_ATTR` attributes. */
export const TOP_BLOCK_TYPES: readonly string[] = [
  NODE.paragraph,
  NODE.heading,
  NODE.quote,
  NODE.bulletList,
  NODE.orderedList,
  NODE.divider,
  NODE.figure,
];

/** `data-*` hooks the Design System `Prose` component reads (see its doc comment). */
export const DATA_ATTR = {
  blockId: 'data-block-id',
  ai: 'data-ai',
  sourceActive: 'data-source-active',
  suggestion: 'data-suggestion',
  stale: 'data-stale',
  sourceState: 'data-source-state',
  pointed: 'data-pointed',
  /** On a figure: the asset it shows (a copy pasted back into the editor keeps its image). */
  assetId: 'data-asset-id',
  /** On a figure's `img` whose file is not available (yet): Prose draws the empty frame. */
  missing: 'data-missing',
  /** On a figure that is an image slot (`figure[data-slot][data-missing]`): the suggestion is in its figcaption. */
  slot: 'data-slot',
  /** On an image slot: `landscape` | `portrait` | `square`, the frame it asks for. */
  orientation: 'data-orientation',
  /** On the block a floating bar decides about: Prose opens the bar's room under it. */
  barSpace: 'data-bar-space',
  /** On an image slot: `line` draws it as one 40 px row ("Imagem sugerida: …") instead of a frame. */
  display: 'data-display',
  /** On an image slot while a file is dragged over it: Prose draws the drop target. */
  over: 'data-over',
} as const;

export const HEADING_LEVELS = [2, 3] as const;
