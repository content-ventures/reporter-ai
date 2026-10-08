'use client';

import { Fragment, useCallback, useEffect, useRef, type DragEvent } from 'react';
import {
  Badge,
  Button,
  LinkButton,
  MediaFrame,
  MetaList,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { Image as ImageIcon, ImagePlus, Pencil, RefreshCw, Trash2, X } from '@content-ventures/design-system/v3/icons';
import { COVER_BLOCK_ID, creditLine, IMAGE_ISSUE_LABELS, IMAGE_LIMITS, imageAlt, type ImageRef } from '@/domain';
import { useArticleCover, useImageSlots } from '@/editor';
import { useAsset, useAssetUrl } from '@/state';
import { usePhone } from '@/ui/use-phone';
import { useStudio } from './studio-context';

/**
 * "Imagem de destaque" above the title (PLAN §3.5, R1 images). Empty: a quiet "Adicionar imagem de
 * destaque" (a dropped image file opens the picker with it). Set: the cover at 16:9 with its
 * caption and credit in one line, as everywhere ("Legenda — Foto: Crédito"; a click on the caption
 * edits it) — "Sem crédito" in red when it has none — and Trocar · Editar legenda e crédito ·
 * Remover (larger on phones). The cover lives in the document (one ⌘Z step), so it autosaves with
 * the text. When the generation suggested a cover, the empty slot says what it should show
 * ("Sugestão: Retrato de …"): adding one starts from the suggestion, and the suggestion can go.
 */
export function CoverSlot() {
  const studio = useStudio();
  const cover = useArticleCover(studio.editor);
  const root = useRef<HTMLElement | null>(null);
  const { bindCover } = studio.images;

  // "Imagem de destaque" in Checagem brings the slot into view with the focus on its first action.
  useEffect(
    () =>
      bindCover({
        reveal: ({ focus = false } = {}) => {
          const element = root.current;
          if (!element) return;
          // The whole cover (image and its line), not only the line with the actions.
          (element.closest('figure') ?? element).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          if (!focus) return;
          const target = element.matches('button') ? element : element.querySelector('button');
          target?.focus({ preventScroll: true });
        },
      }),
    [bindCover],
  );
  const setRoot = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);

  const suggestion = useImageSlots(studio.editor).find((slot) => slot.role === 'cover');
  if (cover) return <CoverImage cover={cover} rootRef={setRoot} />;
  return suggestion ? <SuggestedCover subject={suggestion.slot.subject} rootRef={setRoot} /> : <EmptyCover rootRef={setRoot} />;
}

const LOCKED = 'Aguarde a geração terminar.';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files');
}

function EmptyCover({ rootRef }: { rootRef: (node: HTMLElement | null) => void }) {
  const studio = useStudio();
  const locked = studio.generation.active;
  const add = (file?: File) => {
    if (!locked) studio.images.openCover('choose', file ? { file } : {});
  };
  return (
    <Tooltip content={locked ? LOCKED : IMAGE_LIMITS.hint}>
      <Button
        ref={rootRef}
        variant="ghost"
        size="sm"
        icon={ImageIcon}
        aria-disabled={locked || undefined}
        onClick={() => add()}
        onDragOver={(event) => {
          if (locked || !hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (locked || !hasFiles(event)) return;
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          const image = files.find((file) => file.type.startsWith('image/')) ?? files[0];
          add(image);
        }}
      >
        Adicionar imagem de destaque
      </Button>
    </Tooltip>
  );
}

/**
 * No cover yet, but the generation suggested one: "Adicionar imagem de destaque" (the picker starts
 * from the suggestion; a dropped image file opens it with the file), what to show, and "Remover
 * sugestão" (the toast brings it back). The cover stays optional (D04).
 */
function SuggestedCover({ subject, rootRef }: { subject: string; rootRef: (node: HTMLElement | null) => void }) {
  const studio = useStudio();
  const phone = usePhone();
  const locked = studio.generation.active;
  const readOnly = studio.readOnly;
  const reason = readOnly ? 'Aberta em outra aba' : LOCKED;
  const add = (file?: File) => {
    if (!locked && !readOnly) studio.images.fillSlot(COVER_BLOCK_ID, file ? { file } : { tab: 'upload' });
  };
  // One line on a desktop; on a phone what to show goes under the actions, whole.
  const suggestion = <MetaList size="sm" items={[`Sugestão: ${subject}`]} />;
  const toolbar = (
    <Toolbar ref={rootRef} label="Imagem de destaque" size={phone ? 'md' : 'sm'}>
      <ToolbarButton
        label="Adicionar imagem de destaque"
        icon={ImagePlus}
        showLabel
        disabled={locked || readOnly}
        disabledReason={reason}
        onClick={() => add()}
        onDragOver={(event) => {
          if (locked || readOnly || !hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (locked || readOnly || !hasFiles(event)) return;
          event.preventDefault();
          const files = Array.from(event.dataTransfer.files);
          add(files.find((file) => file.type.startsWith('image/')) ?? files[0]);
        }}
      />
      {phone ? null : suggestion}
      <ToolbarButton
        label="Remover sugestão"
        icon={X}
        disabled={locked || readOnly}
        disabledReason={reason}
        onClick={() => studio.images.dismissSlot(COVER_BLOCK_ID)}
      />
    </Toolbar>
  );
  return phone ? (
    <>
      {toolbar}
      {suggestion}
    </>
  ) : (
    toolbar
  );
}

function CoverImage({ cover, rootRef }: { cover: ImageRef; rootRef: (node: HTMLElement | null) => void }) {
  const studio = useStudio();
  const phone = usePhone();
  const asset = useAsset(cover.assetId);
  const url = useAssetUrl(cover.assetId);
  const locked = studio.generation.active;
  const loading = asset.status === 'loading' || url.status === 'loading';
  const found = asset.data;
  const credit = found ? creditLine(found.credit) : undefined;
  const missing = !loading && !found;
  // The caption opens "Legenda e crédito" on the caption; the credit follows it as everywhere.
  const caption = cover.caption ? (
    <LinkButton tone="inherit" size="inherit" disabled={locked || missing} onClick={() => studio.images.openCover('edit', { focus: 'caption' })}>
      {cover.caption}
    </LinkButton>
  ) : null;

  const facts = [
    caption && credit ? (
      <Fragment key="caption">
        {caption}
        {` — ${credit}`}
      </Fragment>
    ) : caption ? (
      <Fragment key="caption">{caption}</Fragment>
    ) : (
      (credit ?? null)
    ),
    missing ? (
      <Badge key="missing" tone="red" variant="text" size="sm">
        {IMAGE_ISSUE_LABELS.missing_asset}
      </Badge>
    ) : found && !credit ? (
      <Badge key="credit" tone="red" variant="text" size="sm">
        {IMAGE_ISSUE_LABELS.missing_credit}
      </Badge>
    ) : null,
    found && !found.rights.authorized ? (
      <Badge key="rights" tone="red" variant="text" size="sm">
        {IMAGE_ISSUE_LABELS.not_authorized}
      </Badge>
    ) : null,
  ];

  return (
    <MediaFrame
      ratio="16/9"
      src={url.data}
      state={loading ? 'loading' : undefined}
      alt={imageAlt(cover)}
      caption={
        <Toolbar ref={rootRef} label="Imagem de destaque" size={phone ? 'md' : 'sm'}>
          <MetaList size="sm" items={facts} />
          <ToolbarSeparator />
          <ToolbarButton
            label="Trocar imagem de destaque"
            icon={RefreshCw}
            disabled={locked}
            disabledReason={LOCKED}
            onClick={() => studio.images.openCover('choose')}
          />
          <ToolbarButton
            label="Editar legenda e crédito"
            icon={Pencil}
            disabled={locked || missing}
            disabledReason={missing ? 'Troque a imagem: o arquivo não está neste navegador.' : LOCKED}
            onClick={() => studio.images.openCover('edit')}
          />
          <ToolbarButton
            label="Remover imagem de destaque"
            icon={Trash2}
            tone="danger"
            disabled={locked}
            disabledReason={LOCKED}
            onClick={studio.images.removeCover}
          />
        </Toolbar>
      }
    />
  );
}
