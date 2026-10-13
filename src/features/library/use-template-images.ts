'use client';

import { useEffect, useState } from 'react';
import type { AssetId, CarouselBody, TemplateId } from '@/domain';
import type { RenderedSlide } from '@/ports';
import { useCommands } from '@/state';

/**
 * Library images drawn by the RenderService (template DATA rasterised in the browser): a model's
 * cover for its card (`thumbnail`, with the sample copy or with the carousel's own cover texts)
 * and every layout with sample copy for its preview (`preview`). The adapter caches what it drew;
 * this layer keeps what already arrived, so a card or drawer that opens again shows it at once.
 */

export type TemplateImage = { status: 'loading' | 'ready' | 'error'; src?: string; reason?: string };
export type TemplatePreview = { status: 'loading' | 'ready' | 'error'; slides: readonly RenderedSlide[]; reason?: string };

const LOADING: TemplateImage = Object.freeze({ status: 'loading' }) as TemplateImage;
const PREVIEW_LOADING: TemplatePreview = Object.freeze({ status: 'loading', slides: Object.freeze([]) }) as TemplatePreview;
const CACHE_LIMIT = 96;

const thumbnails = new Map<string, TemplateImage>();
const previews = new Map<string, TemplatePreview>();

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

function slotsKey(slots: Readonly<Record<string, string>> | undefined): string {
  if (!slots) return '';
  return Object.keys(slots)
    .sort()
    .map((id) => `${id}=${slots[id]}`)
    .join('\u0001');
}

export type ThumbnailOptions = {
  /** Default 0.4 (432 px wide): sharp on a card of up to ~220 px at 2×. */
  scale?: number;
  /** The article's featured image, for models that draw it. */
  articleCover?: AssetId;
  /** Cover texts by slot id (the carousel's own title and call) instead of the sample copy. */
  slots?: Readonly<Record<string, string>>;
};

/** A model's cover for its card. */
export function useTemplateThumbnail(templateId: TemplateId | undefined, { scale = 0.4, articleCover, slots }: ThumbnailOptions = {}): TemplateImage {
  const commands = useCommands();
  const key = templateId ? [templateId, scale, articleCover ?? '', slotsKey(slots)].join('\u0002') : '';
  const [shown, setShown] = useState<{ key: string; image: TemplateImage }>(() => ({ key, image: thumbnails.get(key) ?? LOADING }));
  if (shown.key !== key) setShown({ key, image: thumbnails.get(key) ?? LOADING });

  useEffect(() => {
    if (!templateId || thumbnails.has(key)) return undefined;
    let alive = true;
    commands.render
      .thumbnail({ templateId, scale, ...(articleCover ? { articleCover } : {}), ...(slots ? { slots } : {}) })
      .then((result) => {
        const image: TemplateImage =
          result.ok && result.value.image
            ? { status: 'ready', src: result.value.image.dataUrl }
            : { status: 'error', reason: result.ok ? result.value.unavailableReason : result.refusal.message };
        if (image.status === 'ready') remember(thumbnails, key, image);
        if (alive) setShown({ key, image });
      })
      .catch(() => {
        if (alive) setShown({ key, image: { status: 'error' } });
      });
    return () => {
      alive = false;
    };
    // `key` names exactly what is drawn (the slots by value, not by identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commands]);

  return shown.key === key ? shown.image : (thumbnails.get(key) ?? LOADING);
}

/** Every layout of a model with its sample copy, in the template's order. */
export function useTemplatePreview(templateId: TemplateId | undefined, { scale = 0.5, articleCover }: { scale?: number; articleCover?: AssetId } = {}): TemplatePreview {
  const commands = useCommands();
  const key = templateId ? [templateId, scale, articleCover ?? ''].join('\u0002') : '';
  const [shown, setShown] = useState<{ key: string; preview: TemplatePreview }>(() => ({ key, preview: previews.get(key) ?? PREVIEW_LOADING }));
  if (shown.key !== key) setShown({ key, preview: previews.get(key) ?? PREVIEW_LOADING });

  useEffect(() => {
    if (!templateId || previews.has(key)) return undefined;
    let alive = true;
    commands.render
      .preview({ templateId, scale, ...(articleCover ? { articleCover } : {}) })
      .then((result) => {
        const preview: TemplatePreview = result.ok
          ? { status: result.value.slides.some((slide) => slide.image) ? 'ready' : 'error', slides: result.value.slides, reason: result.value.slides.find((slide) => !slide.image)?.unavailableReason }
          : { status: 'error', slides: [], reason: result.refusal.message };
        if (preview.status === 'ready' && preview.slides.every((slide) => slide.image)) remember(previews, key, preview);
        if (alive) setShown({ key, preview });
      })
      .catch(() => {
        if (alive) setShown({ key, preview: { status: 'error', slides: [] } });
      });
    return () => {
      alive = false;
    };
  }, [key, commands, templateId, scale, articleCover]);

  return shown.key === key ? shown.preview : (previews.get(key) ?? PREVIEW_LOADING);
}

const carousels = new Map<string, TemplatePreview>();

/** What a body draws: its model, each slide's layout and texts (by value, not by identity). */
function bodyKey(body: CarouselBody): string {
  return [body.templateId, ...body.slides.map((slide) => `${slide.id}\u0003${slide.layout}\u0003${slotsKey(slide.slots)}`)].join('\u0004');
}

/** A carousel's own slides drawn in its model (the carousel moved to another model, before applying). */
export function useCarouselPreview(body: CarouselBody | undefined, { scale = 0.5, articleCover }: { scale?: number; articleCover?: AssetId } = {}): TemplatePreview {
  const commands = useCommands();
  const key = body ? [bodyKey(body), scale, articleCover ?? ''].join('\u0002') : '';
  const [shown, setShown] = useState<{ key: string; preview: TemplatePreview }>(() => ({ key, preview: carousels.get(key) ?? PREVIEW_LOADING }));
  if (shown.key !== key) setShown({ key, preview: carousels.get(key) ?? PREVIEW_LOADING });

  useEffect(() => {
    if (!body || carousels.has(key)) return undefined;
    let alive = true;
    commands.render
      .render({ body, scale, ...(articleCover ? { articleCover } : {}) })
      .then((result) => {
        const preview: TemplatePreview = result.ok
          ? { status: result.value.slides.some((slide) => slide.image) ? 'ready' : 'error', slides: result.value.slides, reason: result.value.slides.find((slide) => !slide.image)?.unavailableReason }
          : { status: 'error', slides: [], reason: result.refusal.message };
        if (preview.status === 'ready' && preview.slides.every((slide) => slide.image)) remember(carousels, key, preview);
        if (alive) setShown({ key, preview });
      })
      .catch(() => {
        if (alive) setShown({ key, preview: { status: 'error', slides: [] } });
      });
    return () => {
      alive = false;
    };
    // `key` names exactly what is drawn (the body by value, not by identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, commands]);

  return shown.key === key ? shown.preview : (carousels.get(key) ?? PREVIEW_LOADING);
}
