'use client';

import { useEffect, useMemo, useState } from 'react';
import { EditableTitle, FloatingToolbar, MediaFrame, PageStack, Prose, ToolbarButton } from '@content-ventures/design-system/v3';
import { CornerDownLeft, Highlighter } from '@content-ventures/design-system/v3/icons';
import { articleAssetIds, imageAlt, type ArticleBody, type DecisionAnchor } from '@/domain';
import {
  EditorContent,
  focusBlock,
  setArticleDecorations,
  useArticleReader,
  useSelectionAnchor,
  useSelectionInfo,
} from '@/editor';
import { anchorsFromRanges, imageCaption } from './review-model';
import { useImageSources, type ImageSources } from './use-image-sources';

/**
 * "Texto final" of an article version (PLAN §3.6): the exact body under review in reading
 * typography (DS `Prose read`, editor in read-only mode — the same schema and `data-*` hooks as
 * the studio). The reviewer may select passages and point at them: they become marks in the text
 * and the list in "Devolver com nota". Passages pointed at by an earlier return stay marked.
 * Images read as the reader will see them: the cover (16:9) above the title, figures in the text,
 * each with its caption and credit ("Foto: …").
 */

export type BlockFocus = { blockId: string; nonce: number };

export type ArticleReadingProps = {
  body: ArticleBody;
  /** "Texto da v4". */
  label: string;
  /** Passages the reviewer is pointing at now (not sent yet). */
  anchors: readonly DecisionAnchor[];
  /** Passages of the last return on this version (already recorded). */
  recorded?: readonly DecisionAnchor[];
  /** Blocks lit from the side pane (source chip hovered or opened). */
  litBlockIds: readonly string[];
  /** Scroll to a block (source chip "Mostrar no texto"). */
  focus?: BlockFocus | null;
  /** Pointing at passages is possible (the version can still be returned). */
  canPoint: boolean;
  onPoint: (anchors: DecisionAnchor[]) => void;
  /** Point at the selection and open "Devolver com nota". */
  onReturnWith: (anchors: DecisionAnchor[]) => void;
};

export function ArticleReading({ body, label, anchors, recorded = [], litBlockIds, focus, canPoint, onPoint, onReturnWith }: ArticleReadingProps) {
  const assetIds = useMemo(() => articleAssetIds(body), [body]);
  const images = useImageSources(assetIds);
  const editor = useArticleReader({ body, figureSources: images.figures });
  const selection = useSelectionInfo(editor);
  const anchor = useSelectionAnchor(editor);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const selectionKey = `${selection.from}:${selection.to}`;
  // A new selection (even of the same passage) brings the bar back.
  if (selection.empty && dismissed !== null) setDismissed(null);
  const open = canPoint && !selection.empty && selection.ranges.length > 0 && dismissed !== selectionKey;

  const marks = useMemo(
    () => [...recorded, ...anchors].map(({ blockId, from, to }) => ({ blockId, from, to })),
    [anchors, recorded],
  );

  // Marks follow the version shown: re-applied when the body is replaced.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, { pointed: marks, activeSourceBlockIds: litBlockIds });
  }, [editor, marks, litBlockIds, body]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !focus) return;
    focusBlock(editor, focus.blockId, { scroll: true });
  }, [editor, focus]);

  function selected(): DecisionAnchor[] {
    return anchorsFromRanges(body, selection.ranges);
  }

  function clearSelection() {
    setDismissed(selectionKey);
    if (editor && !editor.isDestroyed) editor.commands.setTextSelection(selection.to);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <Prose
      variant="read"
      as="article"
      label={label}
      header={
        <PageStack>
          {body.cover ? <CoverImage cover={body.cover} images={images} /> : null}
          <EditableTitle value={body.title} label="Título do artigo" size="document" as="h2" readOnly onCommit={() => undefined} />
        </PageStack>
      }
    >
      <EditorContent editor={editor} />
      <FloatingToolbar
        open={open}
        anchor={anchor}
        label="Ações do trecho"
        onDismiss={() => setDismissed(selectionKey)}
      >
        <ToolbarButton
          label="Apontar trecho"
          icon={Highlighter}
          showLabel
          onClick={() => {
            onPoint(selected());
            clearSelection();
          }}
        />
        <ToolbarButton
          label="Devolver com este trecho"
          icon={CornerDownLeft}
          showLabel
          onClick={() => {
            onReturnWith(selected());
            clearSelection();
          }}
        />
      </FloatingToolbar>
    </Prose>
  );
}

/** The article's cover (imagem de destaque) as published: 16:9, caption and credit below. */
function CoverImage({ cover, images }: { cover: NonNullable<ArticleBody['cover']>; images: ImageSources }) {
  const src = images.url(cover.assetId);
  return (
    <MediaFrame
      ratio="16/9"
      src={src}
      alt={imageAlt(cover)}
      state={src || images.ready ? undefined : 'loading'}
      caption={imageCaption(cover.caption, images.asset(cover.assetId)?.credit)}
    />
  );
}
