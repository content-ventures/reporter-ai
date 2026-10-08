'use client';

import { useEffect, useState } from 'react';
import { Alert, ErrorState, Gallery, LoadingSwap, Skeleton, useWorkspace, type GalleryItem } from '@content-ventures/design-system/v3';
import { exportFileName, type AssetId, type CarouselBody } from '@/domain';
import type { RenderedSlide } from '@/ports';
import { useCommands } from '@/state';
import { formatCount } from '@/ui/format';

/**
 * The carousel under review as the creatives themselves (PLAN §3.7): every slide rasterised by
 * the RenderService from the template data (PNG 1080×1350), shown in the DS `Gallery` — the
 * DS only frames them. Renders are cached per version hash (and article cover), so switching
 * views is instant. Layouts whose template data asks for it draw the article's cover behind the
 * text; without one (or with a linked cover) they keep the template colours.
 */

const renders = new Map<string, RenderedSlide[]>();

type RenderState = { key: string; slides?: RenderedSlide[]; error?: string };

function useRenderedSlides(body: CarouselBody, hash: string, articleCover: AssetId | undefined): RenderState & { retry: () => void } {
  const commands = useCommands();
  const [attempt, setAttempt] = useState(0);
  const drawn = articleCover ? `${hash}:${articleCover}` : hash;
  const key = `${drawn}:${attempt}`;
  const [state, setState] = useState<RenderState>(() => ({ key, slides: renders.get(drawn) }));
  if (state.key !== key) setState({ key, slides: renders.get(drawn) });

  useEffect(() => {
    if (renders.has(drawn)) return undefined;
    let alive = true;
    commands.render
      .render({ body, ...(articleCover ? { articleCover } : {}) })
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          renders.set(drawn, result.value.slides);
          setState({ key, slides: result.value.slides });
        } else {
          setState({ key, error: result.refusal.message });
        }
      })
      .catch(() => {
        if (alive) setState({ key, error: 'Não foi possível desenhar os slides.' });
      });
    return () => {
      alive = false;
    };
  }, [articleCover, body, commands, drawn, key]);

  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/** A `data:` URL as a Blob, synchronously (base64 or URL-encoded payload). */
function dataUrlBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const type = /^data:([^;,]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  if (!head.endsWith(';base64')) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

/**
 * Opens the PNG in a new tab (the lightbox "Baixar"); the package itself is in Entrega. The tab
 * opens within the click, with no await before it (Safari blocks a popup opened after one).
 */
function openImage(dataUrl: string) {
  const url = URL.createObjectURL(dataUrlBlob(dataUrl));
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type CarouselSlidesProps = {
  body: CarouselBody;
  hash: string;
  versionNumber: number;
  /** Cover of the article version the carousel was made from (`VersionDetail.articleCover`). */
  articleCover?: AssetId;
};

export function CarouselSlides({ body, hash, versionNumber, articleCover }: CarouselSlidesProps) {
  const rendered = useRenderedSlides(body, hash, articleCover);
  const [index, setIndex] = useState(0);
  // Wide: a landscape stage capped at the visible height (DS `Gallery fitHeight`) keeps the whole
  // 4:5 slide and the strip in view without an inner scroll; narrow: square.
  const narrow = useWorkspace()?.narrow ?? false;

  if (rendered.error) {
    return <ErrorState title="Não foi possível desenhar os slides" description={rendered.error} onRetry={rendered.retry} />;
  }

  const slides = rendered.slides ?? [];
  const unavailable = slides.find((slide) => !slide.image)?.unavailableReason;
  const items: GalleryItem[] = slides.map((slide) => {
    const overflow = slide.fits.filter((fit) => fit.overflow).map((fit) => fit.message ?? `≈ ${fit.label} excede ${fit.maxLines} linhas`);
    // The article has a cover this layout asks for, but it could not be drawn (linked, missing).
    const background = articleCover && slide.background && !slide.background.drawn ? slide.background.reason : undefined;
    return {
      id: slide.slideId,
      src: slide.image?.dataUrl,
      alt: `Slide ${slide.index + 1} de ${slides.length}`,
      ratio: `${slide.width}/${slide.height}`,
      label: exportFileName('carousel', { number: versionNumber }, 'png', slide.index),
      meta: [`${formatCount(slide.width)} × ${formatCount(slide.height)} px · PNG`, ...overflow, background].filter(Boolean).join(' · '),
    };
  });

  return (
    <LoadingSwap loading={!rendered.slides} skeleton={<Skeleton shape="block" height={narrow ? 360 : 480} />} label="Desenhando os slides">
      {unavailable ? <Alert tone="warning" title="Prévia indisponível neste navegador">{unavailable}</Alert> : null}
      <Gallery
        items={items}
        index={Math.min(index, Math.max(0, items.length - 1))}
        onIndexChange={setIndex}
        label={`Slides da versão ${versionNumber}`}
        stageRatio={narrow ? '1/1' : '16/10'}
        fitHeight={!narrow}
        onDownload={(item) => {
          if (item.src) openImage(item.src);
        }}
      />
    </LoadingSwap>
  );
}
