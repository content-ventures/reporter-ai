import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { BlockId } from '../domain/index.ts';
import { figurePlacementAt, figurePlacementAtPos, foreignFigures, isFigureNode } from './figures.ts';
import { blockIdOf } from './ranges.ts';
import type { FigurePlacement, ForeignFigure } from './figures.ts';
import { FIGURE_ATTR } from './schema.ts';

/**
 * Images that arrive by paste or drop. The editor never stores a file: image files go to
 * `onImageFiles` with a placement anchored to a block (it stays right while the file uploads),
 * and the host inserts the figure once the asset exists (`insertFigure`). Text, links and HTML
 * paste and drop exactly as before. Images inside pasted HTML from another page become figures
 * without an asset, reported once through `onForeignImages` for the host to adopt as link assets
 * (`updateFigure(…, { assetId }, { history: false })`); with no handler they are left out of the
 * paste.
 */

export type ImageFilesHandler = (files: File[], placement: FigurePlacement) => void;
export type ForeignImagesHandler = (images: ForeignFigure[]) => void;

export type ImageInputOptions = {
  onImageFiles?: ImageFilesHandler;
  onForeignImages?: ForeignImagesHandler;
  /** Files dropped that are not images (nothing is inserted; the browser does not open them). */
  onRejectedFiles?: (files: File[]) => void;
  /** A click on a figure's caption (or credit line), in an editable text: edit it there. */
  onFigureCaption?: (blockId: BlockId) => void;
};

/** What the plugin reads from `ClipboardEvent.clipboardData` / `DragEvent.dataTransfer`. */
export type TransferLike = { files?: ArrayLike<File> | null; getData: (format: string) => string };

export function filesOf(list: ArrayLike<File> | null | undefined): File[] {
  return list ? Array.from(list) : [];
}

/** Any `image/*` file: the host validates the accepted types and size (`validateImageFile`). */
export function isImageFile(file: Pick<File, 'type'>): boolean {
  return file.type.toLowerCase().startsWith('image/');
}

/** Visible text of an HTML fragment (no DOM: tags, comments, styles and scripts stripped). */
function htmlText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .trim();
}

/**
 * The image files a paste hands over, or `[]` for the default paste. Copied text often comes
 * with a picture of itself (Word, Sheets, Docs): when the clipboard has text beyond the files'
 * names, the text wins.
 */
export function pastedImageFiles(data: TransferLike): File[] {
  const files = filesOf(data.files);
  const images = files.filter(isImageFile);
  if (images.length === 0) return [];
  const html = data.getData('text/html');
  if (html && htmlText(html)) return [];
  const text = data.getData('text/plain').trim();
  if (!html && text && !files.some((file) => file.name && text.includes(file.name))) return [];
  return images;
}

/** A pasted slice without figures that no asset holds (when nobody adopts them). */
export function withoutForeignFigures(slice: Slice): Slice {
  const nodes: PMNode[] = [];
  let removedFirst = false;
  let removedLast = false;
  slice.content.forEach((node, _offset, index) => {
    const foreign = isFigureNode(node) && !node.attrs[FIGURE_ATTR.assetId];
    if (!foreign) {
      nodes.push(node);
      return;
    }
    if (index === 0) removedFirst = true;
    if (index === slice.content.childCount - 1) removedLast = true;
  });
  if (nodes.length === slice.content.childCount) return slice;
  if (nodes.length === 0) return Slice.empty;
  return new Slice(Fragment.fromArray(nodes), removedFirst ? 0 : slice.openStart, removedLast ? 0 : slice.openEnd);
}

export const imageInputKey = new PluginKey('reporterImageInput');

type PointView = { state: EditorState; posAtCoords: (coords: { left: number; top: number }) => { pos: number; inside: number } | null };

/** Placement for a drop at a window point (the caret placement when the point is off the text). */
export function dropPlacement(view: PointView, event: Pick<MouseEvent, 'clientX' | 'clientY'>): FigurePlacement {
  const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
  return point ? figurePlacementAtPos(view.state.doc, point.pos) : figurePlacementAt(view.state);
}

/** `handlers` may be a getter, read on every event (the editor host swaps callbacks freely). */
export function imageInputPlugin(handlers: ImageInputOptions | (() => ImageInputOptions) = {}): Plugin {
  const current = typeof handlers === 'function' ? handlers : () => handlers;
  return new Plugin({
    key: imageInputKey,
    props: {
      handlePaste(view, event) {
        const options = current();
        if (!options.onImageFiles || !event.clipboardData) return false;
        const files = pastedImageFiles(event.clipboardData);
        if (files.length === 0) return false;
        options.onImageFiles(files, figurePlacementAt(view.state));
        return true;
      },
      handleDrop(view, event, slice, moved) {
        const options = current();
        if (moved || !event.dataTransfer) return false;
        const files = filesOf(event.dataTransfer.files);
        if (files.length === 0) return false;
        const images = files.filter(isImageFile);
        if (images.length === 0) {
          if (slice.content.size > 0) return false;
          options.onRejectedFiles?.(files);
          return true;
        }
        if (!options.onImageFiles) return false;
        options.onImageFiles(images, dropPlacement(view, event));
        return true;
      },
      transformPasted(slice) {
        return current().onForeignImages ? slice : withoutForeignFigures(slice);
      },
      handleClickOn(view, _pos, node, _nodePos, event, direct) {
        const handler = current().onFigureCaption;
        if (!handler || !direct || !view.editable || !isFigureNode(node)) return false;
        const target = event.target as { closest?: (selector: string) => unknown } | null;
        const id = blockIdOf(node);
        // The node is still selected as a whole (default click); the host opens the caption.
        if (id && typeof target?.closest === 'function' && target.closest('figcaption')) handler(id);
        return false;
      },
    },
    view(editorView) {
      const reported = new Set<BlockId>();
      const report = (state: EditorState) => {
        const handler = current().onForeignImages;
        if (!handler) return;
        const fresh = foreignFigures(state.doc).filter((image) => !reported.has(image.blockId));
        if (fresh.length === 0) return;
        for (const image of fresh) reported.add(image.blockId);
        // After the paste settles: the host may dispatch (adopt or remove) from the handler.
        queueMicrotask(() => handler(fresh));
      };
      report(editorView.state);
      return {
        update(view, previous) {
          if (view.state.doc !== previous.doc) report(view.state);
        },
      };
    },
  });
}
