'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AssetId, CarouselBody, Slide, SlideId } from '@/domain';
import type { SlideBackground, SlotFit } from '@/ports';
import { useAsset, useCommands } from '@/state';

/**
 * Slides drawn as PNG by the RenderService (template DATA rasterised in the browser), cached by
 * what is drawn: template, scale, page "2/5", layout, slot text and the article cover with its
 * credit (drawn behind the text on layouts whose template data asks for it). Editing a slot
 * re-renders only that slide, after a short pause; meanwhile the previous image stays (no flicker).
 */

export type SlideRender = {
  status: 'loading' | 'ready' | 'error';
  src?: string;
  fits: SlotFit[];
  overflow: boolean;
  reason?: string;
  /** Layouts that use the article cover: whether it was drawn, and why not. */
  background?: SlideBackground;
};

const LOADING: SlideRender = Object.freeze({ status: 'loading', fits: [], overflow: false }) as SlideRender;
const CACHE_LIMIT = 96;

const cache = new Map<string, SlideRender>();
/** Last image per slide and scale, shown while the new one is drawn. */
const latest = new Map<string, SlideRender>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function remember(key: string, value: SlideRender) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

function slotsKey(slide: Slide): string {
  return Object.keys(slide.slots)
    .sort()
    .map((id) => `${id}=${slide.slots[id]}`)
    .join('\u0001');
}

export function renderKey(body: CarouselBody, index: number, scale: number, articleCover?: AssetId, coverCredit?: string): string {
  const slide = body.slides[index];
  return [body.templateId, scale, `${index + 1}/${body.slides.length}`, slide.layout, slotsKey(slide), articleCover ?? '', coverCredit ?? ''].join('\u0002');
}

export type RenderOptions = {
  /** 1 = 1080×1350 (stage, gallery) · 0.25 = strip thumbnails. */
  scale: number;
  /** Only these slides (default: all). */
  slideIds?: readonly SlideId[];
  /** Pause after a change before drawing, in ms. */
  delay?: number;
  /** Cover of the article the slides come from (`DraftView.articleCover`). */
  articleCover?: AssetId;
};

export function useSlideRenders(body: CarouselBody | undefined, { scale, slideIds, delay = 220, articleCover }: RenderOptions): Record<SlideId, SlideRender> {
  const commands = useCommands();
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((tick) => tick + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  // A corrected credit redraws the slides that set it.
  const coverCredit = useAsset(articleCover).data?.credit;
  const wanted = useMemo(() => {
    if (!body) return [];
    return body.slides
      .map((slide, index) => ({ slide, key: renderKey(body, index, scale, articleCover, coverCredit) }))
      .filter(({ slide }) => !slideIds || slideIds.includes(slide.id));
  }, [articleCover, coverCredit, body, scale, slideIds]);

  const missing = wanted.filter(({ key }) => !cache.has(key));
  const missingKey = missing.map(({ key }) => key).join('\u0003');

  useEffect(() => {
    if (!body || missing.length === 0) return undefined;
    const timer = window.setTimeout(async () => {
      const todo = missing.filter(({ key }) => !cache.has(key) && !inFlight.has(key));
      if (todo.length === 0) return;
      todo.forEach(({ key }) => inFlight.add(key));
      const result = await commands.render.render({ body, slideIds: todo.map(({ slide }) => slide.id), scale, ...(articleCover ? { articleCover } : {}) });
      todo.forEach(({ slide, key }) => {
        inFlight.delete(key);
        const drawn = result.ok ? result.value.slides.find((entry) => entry.slideId === slide.id) : undefined;
        const value: SlideRender = drawn
          ? {
              status: drawn.image ? 'ready' : 'error',
              src: drawn.image?.dataUrl,
              fits: drawn.fits,
              overflow: drawn.overflow,
              reason: drawn.unavailableReason,
              ...(drawn.background ? { background: drawn.background } : {}),
            }
          : { status: 'error', fits: [], overflow: false, reason: result.ok ? 'Slide não encontrado.' : result.refusal.message };
        remember(key, value);
        latest.set(`${slide.id}|${scale}`, value);
      });
      emit();
    }, cache.size === 0 ? 0 : delay);
    return () => window.clearTimeout(timer);
    // `missingKey` names exactly what is missing; `body` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, commands, scale, delay, articleCover]);

  const out: Record<SlideId, SlideRender> = {};
  for (const { slide, key } of wanted) {
    out[slide.id] = cache.get(key) ?? latest.get(`${slide.id}|${scale}`) ?? LOADING;
  }
  return out;
}

/** Forget cached images (e.g. "Tentar de novo" after a drawing error). */
export function clearSlideRenders(slideId?: SlideId) {
  for (const [key, value] of cache) {
    if (value.status === 'error' || !slideId) cache.delete(key);
  }
  if (slideId) for (const key of [...latest.keys()]) if (key.startsWith(`${slideId}|`)) latest.delete(key);
  emit();
}
