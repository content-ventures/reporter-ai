'use client';

import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { toast } from '@content-ventures/design-system/v3';
import { articleAssetIds, COVER_BLOCK_ID, IMAGE_LIMITS, imageSlotDefaults, type ArticleBody, type AssetId, type AssetLookup, type BlockId, type ProductionId } from '@/domain';
import {
  blockIdOf,
  coverOf,
  dismissImageSlot,
  figurePlacementAt,
  figuresIn,
  fillImageSlot,
  findFigure,
  findImageSlot,
  insertFigure,
  removeFigure as removeFigureFromDoc,
  setArticleCover,
  updateFigure,
  type Editor,
  type FigureInfo,
  type FigurePlacement,
  type FigureSources,
  type ForeignFigure,
  type ImageInputOptions,
} from '@/editor';
import type { ImageSourceId } from '@/registries';
import { useAssetLookup, useCommands } from '@/state';
import { plural } from '@/ui/format';
import { probeImage } from '@/ui/image-probe';
import type { PickedImage, PickerRequest } from './image-picker';
import type { PickerMode } from './image-model';
import { useFigureSources } from './use-figure-sources';

/**
 * Images of the article studio: the display data of every image (cover and figures), the picker
 * request ("Inserir imagem", "Imagem de destaque", "Legenda e crédito"), what a pasted or dropped
 * file does (opens the picker with it, at the drop position), images pasted from another page
 * (kept as "Link externo" assets once their address proves to be an image) and the actions of the
 * image bars, each with its way back ("Desfazer", "Remover"). Images the generation suggested
 * (slots, and the cover's suggestion) are filled through the same picker — on the chosen source,
 * alt text and caption started from the suggestion — or removed, with "Desfazer". Editor actions
 * read the editor at call time, so this runs before the editor exists (it hands it
 * `figureSources` and the paste/drop handlers).
 */

export type CoverHandle = { reveal: (options?: { focus?: boolean }) => void };

/** Pasted images smaller than this on a side (icons, tracking pixels) are left out. */
const MIN_PASTED_SIDE = 48;

/**
 * Runs once the picker's drawer has finished closing (its modal `dialog` keeps the page inert
 * until then, so the focus cannot move earlier). Bounded: never waits more than a second.
 */
function afterDrawer(run: () => void, deadline = Date.now() + 1000): void {
  if (!document.querySelector('dialog[open]') || Date.now() > deadline) run();
  else window.requestAnimationFrame(() => afterDrawer(run, deadline));
}

/** Nothing has the focus (the drawer's trigger is gone): the next target may take it. */
function focusIsFree(): boolean {
  return !document.activeElement || document.activeElement === document.body;
}

/**
 * Selects a figure the picker just placed (its bar shows credit and rights), brings it into
 * view and, once the drawer is gone, gives the text the focus back (typing goes on after it).
 */
function selectFigure(editor: Editor, blockId: BlockId): void {
  const figure = findFigure(editor.state.doc, blockId);
  if (!figure) return;
  editor.commands.setNodeSelection(figure.pos);
  const element = (): Element | null => {
    if (editor.isDestroyed) return null;
    const current = findFigure(editor.state.doc, blockId);
    const dom = current ? editor.view.nodeDOM(current.pos) : null;
    return dom instanceof Element ? dom : null;
  };
  // After the layout (the browser's scroll anchoring may have pushed the text down by the image).
  window.requestAnimationFrame(() => {
    const dom = element();
    if (!dom) return;
    dom.scrollIntoView({ block: 'center' });
    // An image without a known size reserves no box until decoded: centre it again then, unless
    // the person scrolled meanwhile.
    const img = dom.querySelector('img[src]:not([height])');
    if (!(img instanceof HTMLImageElement)) return;
    const top = dom.getBoundingClientRect().top;
    img.decode().then(
      () => {
        const again = element();
        if (again && Math.abs(again.getBoundingClientRect().top - top) < 2) again.scrollIntoView({ block: 'center' });
      },
      () => undefined,
    );
  });
  afterDrawer(() => {
    if (!editor.isDestroyed && !editor.view.hasFocus()) editor.view.focus();
  });
}

/** Where a figure sits, by its neighbours (to put it back after "Desfazer"). */
function placementOf(editor: Editor, figure: FigureInfo): FigurePlacement {
  const { doc } = editor.state;
  const before = figure.index > 0 ? blockIdOf(doc.child(figure.index - 1)) : null;
  if (before) return { after: before };
  const after = figure.index + 1 < doc.childCount ? blockIdOf(doc.child(figure.index + 1)) : null;
  return after ? { before: after } : 'end';
}

/** A figure as `insertFigure` takes it back (same block id, image and display data). */
function figureInput(figure: FigureInfo & { assetId: AssetId }) {
  return {
    blockId: figure.blockId,
    assetId: figure.assetId,
    ...(figure.alt ? { alt: figure.alt } : {}),
    ...(figure.caption ? { caption: figure.caption } : {}),
    ...(figure.src ? { src: figure.src } : {}),
    ...(figure.credit ? { credit: figure.credit } : {}),
    ...(figure.width ? { width: figure.width } : {}),
    ...(figure.height ? { height: figure.height } : {}),
  };
}

export type ArticleImages = {
  sources: FigureSources;
  /** Paste, drop and caption-click handlers for `useArticleEditor`. */
  input: Required<ImageInputOptions>;
  lookup: AssetLookup;
  picker: PickerRequest | null;
  closePicker: () => void;
  /** Stores nothing: the picker already did. Puts the picked image in the text. */
  applyPicked: (request: PickerRequest, picked: PickedImage) => Promise<void>;
  /** Images on screen not saved yet and those an undo can bring back ("Liberar espaço" keeps them). */
  inUse: () => AssetId[];
  /** "Inserir imagem": a new figure next to the caret (or at `placement`). */
  insertImage: (placement?: FigurePlacement, file?: File) => void;
  editFigure: (blockId: BlockId, focus?: 'caption') => void;
  replaceFigure: (blockId: BlockId) => void;
  removeFigure: (blockId: BlockId) => void;
  /** "Definir como destaque": the figure's image becomes the cover (alt and caption go along). */
  makeCover: (blockId: BlockId) => void;
  openCover: (mode: PickerMode, options?: { file?: File; focus?: 'caption' }) => void;
  removeCover: () => void;
  /** "Enviar imagem" / "Usar link" on a suggestion (a figure slot or `COVER_BLOCK_ID`): the picker on that source. */
  fillSlot: (blockId: BlockId, options?: { tab?: ImageSourceId; file?: File }) => void;
  /** "Remover sugestão": the suggestion leaves the text (one undoable step; the toast brings it back). */
  dismissSlot: (blockId: BlockId) => void;
  bindCover: (handle: CoverHandle) => () => void;
  revealCover: () => void;
};

export function useArticleImages({
  productionId,
  body,
  editorRef,
  showText,
  locked,
}: {
  productionId: ProductionId;
  /** The body on screen (its images get display data even before the asset list answers). */
  body: ArticleBody;
  editorRef: RefObject<Editor | null>;
  /** Brings the text into view (narrow tabs). */
  showText: () => void;
  /** A generation is writing the text: images wait (a pasted or dropped file says so). */
  locked: boolean;
}): ArticleImages {
  const commands = useCommands();
  const lookup = useAssetLookup();
  // Display data only for the images the text uses and the ones it used in this session (an undo
  // can bring them back), never the production's whole image list.
  const used = useMemo(() => articleAssetIds(body), [body]);
  const [kept, setKept] = useState<readonly AssetId[]>([]);
  const fresh = used.filter((assetId) => !kept.includes(assetId));
  if (fresh.length > 0) setKept([...kept, ...fresh]);
  const assetIds = useMemo(() => [...new Set([...used, ...kept])], [used, kept]);
  const figures = useFigureSources(assetIds);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const requests = useRef(0);
  const cover = useRef<CoverHandle | null>(null);

  /** Remembers an image the text used (its display data stays while the studio is open). */
  const remember = useCallback((assetId: AssetId) => {
    setKept((current) => (current.includes(assetId) ? current : [...current, assetId]));
  }, []);

  const open = useCallback((request: Omit<PickerRequest, 'key'>) => {
    requests.current += 1;
    setPicker({ ...request, key: requests.current });
  }, []);
  const closePicker = useCallback(() => setPicker(null), []);

  const live = useCallback((): Editor | null => {
    const editor = editorRef.current;
    return editor && !editor.isDestroyed ? editor : null;
  }, [editorRef]);

  const inUse = useCallback((): AssetId[] => {
    const editor = live();
    const ids = new Set(kept);
    if (editor) {
      const current = coverOf(editor.state.doc);
      if (current) ids.add(current.assetId);
      for (const figure of figuresIn(editor.state.doc)) if (figure.assetId) ids.add(figure.assetId);
    }
    return [...ids];
  }, [live, kept]);

  const bindCover = useCallback((handle: CoverHandle) => {
    cover.current = handle;
    return () => {
      if (cover.current === handle) cover.current = null;
    };
  }, []);
  const revealCover = useCallback(() => {
    showText();
    cover.current?.reveal({ focus: true });
  }, [showText]);

  const insertImage = useCallback(
    (placement?: FigurePlacement, file?: File) => {
      const editor = live();
      // Decided now: the drawer takes the focus, the caret's block stays the anchor.
      const where = placement ?? (editor ? figurePlacementAt(editor.state) : 'end');
      open({ role: 'figure', mode: 'choose', placement: where, ...(file ? { file } : {}) });
    },
    [live, open],
  );

  const figureRequest = useCallback(
    (blockId: BlockId, mode: PickerMode, focus?: 'caption') => {
      const editor = live();
      const figure = editor ? findFigure(editor.state.doc, blockId) : null;
      if (!figure?.assetId) return;
      const current = { assetId: figure.assetId, ...(figure.alt ? { alt: figure.alt } : {}), ...(figure.caption ? { caption: figure.caption } : {}) };
      open({ role: 'figure', mode, blockId, current, ...(focus ? { focus } : {}) });
    },
    [live, open],
  );
  const editFigure = useCallback((blockId: BlockId, focus?: 'caption') => figureRequest(blockId, 'edit', focus), [figureRequest]);
  const replaceFigure = useCallback((blockId: BlockId) => figureRequest(blockId, 'choose'), [figureRequest]);

  /** Removes the figure; "Desfazer" puts the same figure back where it was (⌘Z needs the text). */
  const removeFigure = useCallback(
    (blockId: BlockId) => {
      const editor = live();
      const figure = editor ? findFigure(editor.state.doc, blockId) : null;
      if (!editor || !figure) return;
      const placement = placementOf(editor, figure);
      if (!removeFigureFromDoc(editor, blockId)) return;
      const { assetId } = figure;
      if (!assetId) return;
      toast('Imagem removida do texto', {
        action: {
          label: 'Desfazer',
          onClick: () => {
            const current = live();
            if (current && !findFigure(current.state.doc, blockId)) insertFigure(current, figureInput({ ...figure, assetId }), placement);
          },
        },
      });
    },
    [live],
  );

  /** The figure's image becomes the cover; it stays in the text unless the person takes it out. */
  const makeCover = useCallback(
    (blockId: BlockId) => {
      const editor = live();
      const figure = editor ? findFigure(editor.state.doc, blockId) : null;
      if (!editor || !figure?.assetId) return;
      setArticleCover(editor, { assetId: figure.assetId, ...(figure.alt ? { alt: figure.alt } : {}), ...(figure.caption ? { caption: figure.caption } : {}) });
      cover.current?.reveal();
      toast('Imagem definida como destaque', {
        description: 'Ela continua também no texto.',
        action: {
          label: 'Remover do texto',
          onClick: () => {
            const current = live();
            if (current) removeFigureFromDoc(current, blockId);
          },
        },
      });
    },
    [live],
  );

  const openCover = useCallback(
    (mode: PickerMode, options: { file?: File; focus?: 'caption' } = {}) => {
      const editor = live();
      const current = editor ? coverOf(editor.state.doc) : null;
      open({
        role: 'cover',
        mode: current ? mode : 'choose',
        ...(current ? { current } : {}),
        ...(options.file ? { file: options.file } : {}),
        ...(current && options.focus ? { focus: options.focus } : {}),
      });
    },
    [live, open],
  );

  /** The focus was on the removed slot: the toast brings that exact cover back (⌘Z needs the text). */
  const removeCover = useCallback(() => {
    const editor = live();
    const previous = editor ? coverOf(editor.state.doc) : null;
    if (!editor || !previous || !setArticleCover(editor, null)) return;
    toast('Imagem de destaque removida', {
      action: {
        label: 'Desfazer',
        onClick: () => {
          const current = live();
          if (current && !coverOf(current.state.doc)) setArticleCover(current, previous);
        },
      },
    });
  }, [live]);

  const fillSlot = useCallback(
    (blockId: BlockId, options: { tab?: ImageSourceId; file?: File } = {}) => {
      const editor = live();
      const found = editor ? findImageSlot(editor.state.doc, blockId) : null;
      if (!found) return;
      open({
        role: found.role,
        mode: 'choose',
        slot: { blockId, subject: found.slot.subject },
        prefill: imageSlotDefaults(found.slot),
        ...(options.tab ? { tab: options.tab } : {}),
        ...(options.file ? { file: options.file } : {}),
      });
    },
    [live, open],
  );

  /** The suggestion leaves; "Desfazer" undoes exactly that step while nothing else changed since. */
  const dismissSlot = useCallback(
    (blockId: BlockId) => {
      const editor = live();
      if (!editor || !dismissImageSlot(editor, blockId)) return;
      const after = editor.state.doc;
      toast(blockId === COVER_BLOCK_ID ? 'Sugestão de destaque removida' : 'Sugestão de imagem removida', {
        action: {
          label: 'Desfazer',
          onClick: () => {
            const current = live();
            if (current && current.state.doc === after) current.commands.undo();
          },
        },
      });
    },
    [live],
  );

  const { display } = figures;
  const applyPicked = useCallback(
    async (request: PickerRequest, { asset, image }: PickedImage) => {
      const editor = live();
      if (!editor) return;
      remember(asset.id);
      const shown = await display(asset.id);
      setPicker(null);
      showText();
      if (request.slot && request.role === 'figure') {
        const { blockId } = request.slot;
        if (!fillImageSlot(editor, blockId, { ...image, ...shown })) {
          toast('A sugestão saiu do texto', { tone: 'info', description: 'Insira a imagem onde ela deve ficar.' });
          return;
        }
        selectFigure(editor, blockId);
        return;
      }
      if (request.role === 'cover') {
        // A cover answers the cover's suggestion too (it leaves with the same step).
        setArticleCover(editor, image);
        // After the slot re-renders with the image; the focus goes to it when its trigger is gone.
        window.requestAnimationFrame(() => cover.current?.reveal());
        afterDrawer(() => {
          if (focusIsFree()) cover.current?.reveal({ focus: true });
        });
        return;
      }
      if (request.blockId) {
        if (!findFigure(editor.state.doc, request.blockId)) {
          toast('A imagem saiu do texto', { tone: 'info', description: 'Insira a imagem de novo onde ela deve ficar.' });
          return;
        }
        updateFigure(editor, request.blockId, {
          assetId: image.assetId,
          alt: image.alt ?? null,
          caption: image.caption ?? null,
          src: shown.src ?? null,
          credit: shown.credit ?? null,
          width: shown.width ?? null,
          height: shown.height ?? null,
        });
        selectFigure(editor, request.blockId);
        return;
      }
      const blockId = insertFigure(editor, { ...image, ...shown }, request.placement ?? 'selection');
      if (blockId) selectFigure(editor, blockId);
    },
    [live, display, showText, remember],
  );

  // ——— Paste, drop and caption clicks ———
  const onImageFiles = useCallback(
    (files: File[], placement: FigurePlacement) => {
      const [file, ...rest] = files;
      if (!file) return;
      if (locked) {
        toast('Imagem não inserida', { tone: 'info', description: 'Aguarde a geração terminar.' });
        return;
      }
      insertImage(placement, file);
      if (rest.length > 0) toast(`${plural(rest.length, 'imagem ficou', 'imagens ficaram')} de fora`, { tone: 'info', description: 'Insira uma imagem por vez.' });
    },
    [insertImage, locked],
  );
  /** A file dropped on a suggestion (or pasted with it selected) answers it: the picker opens on that file. */
  const onSlotFiles = useCallback(
    (files: File[], blockId: BlockId) => {
      const [file, ...rest] = files;
      if (!file) return;
      if (locked) {
        toast('Imagem não inserida', { tone: 'info', description: 'Aguarde a geração terminar.' });
        return;
      }
      fillSlot(blockId, { tab: 'upload', file });
      if (rest.length > 0) toast(`${plural(rest.length, 'imagem ficou', 'imagens ficaram')} de fora`, { tone: 'info', description: 'Insira uma imagem por vez.' });
    },
    [fillSlot, locked],
  );
  const onRejectedFiles = useCallback((files: File[]) => {
    toast(files.length === 1 ? 'O arquivo não é uma imagem' : 'Os arquivos não são imagens', { tone: 'error', description: IMAGE_LIMITS.hint });
  }, []);
  const onFigureCaption = useCallback(
    (blockId: BlockId) => {
      if (!locked) editFigure(blockId, 'caption');
    },
    [editFigure, locked],
  );
  /**
   * Images from another page: each address must open an image of a useful size (icons and
   * tracking pixels are left out); the rest are kept as "Link externo" assets, without
   * authorisation until someone confirms it. The toast takes them all out again.
   */
  const onForeignImages = useCallback(
    (images: ForeignFigure[]) => {
      void (async () => {
        const kept: BlockId[] = [];
        let lost = 0;
        for (const image of images) {
          const probe = await probeImage(image.url);
          const size = probe.status === 'loaded' && probe.width >= MIN_PASTED_SIDE && probe.height >= MIN_PASTED_SIDE ? probe : null;
          const result = size
            ? await commands.assets.put(
                { type: 'url', url: image.url, width: size.width, height: size.height },
                { productionId, authorized: false, ...(image.credit ? { credit: image.credit } : {}) },
              )
            : null;
          const editor = live();
          if (!editor) return;
          if (result?.ok && size && updateFigure(editor, image.blockId, { assetId: result.value.id, width: size.width, height: size.height }, { history: false })) {
            remember(result.value.id);
            kept.push(image.blockId);
          } else if (removeFigureFromDoc(editor, image.blockId)) lost += 1;
        }
        if (kept.length > 0) {
          toast(kept.length === 1 ? 'Imagem colada como link externo' : `${kept.length} imagens coladas como link externo`, {
            description: 'Confira crédito e uso autorizado.',
            action: {
              label: 'Remover',
              onClick: () => {
                const editor = live();
                if (editor) for (const blockId of kept) removeFigureFromDoc(editor, blockId);
              },
            },
          });
        }
        if (lost > 0) {
          toast(lost === 1 ? 'Uma imagem colada ficou de fora' : `${lost} imagens coladas ficaram de fora`, {
            tone: 'info',
            description: 'O endereço não abre uma imagem. Envie o arquivo por Inserir imagem.',
          });
        }
      })();
    },
    [commands, productionId, live, remember],
  );
  // Enter on a selected suggestion ("pressione Enter para escolher"): the picker on "Enviar imagem".
  const onSlotOpen = useCallback((blockId: BlockId) => fillSlot(blockId, { tab: 'upload' }), [fillSlot]);
  const input = useMemo(
    () => ({ onImageFiles, onSlotFiles, onForeignImages, onRejectedFiles, onFigureCaption, onSlotOpen }),
    [onImageFiles, onSlotFiles, onForeignImages, onRejectedFiles, onFigureCaption, onSlotOpen],
  );

  return {
    sources: figures.sources,
    input,
    lookup,
    picker,
    closePicker,
    applyPicked,
    inUse,
    insertImage,
    editFigure,
    replaceFigure,
    removeFigure,
    makeCover,
    openCover,
    removeCover,
    fillSlot,
    dismissSlot,
    bindCover,
    revealCover,
  };
}
