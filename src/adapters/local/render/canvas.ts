import type { CarouselTemplate, Slide } from '../../../domain/carousel.ts';
import type { LaidSlot } from './slide-layout.ts';
import { BASE_FAMILY, cssFont, MARGIN } from './templates.ts';
import type { TemplateRender, Typefaces } from './templates.ts';
import { ellipsize } from './text-metrics.ts';

/**
 * Draws one slide on a 2D context: background, colour blocks, the article cover where the
 * template asks for it (with its scrim), accent rule, marks and the large number (template
 * data), slot texts, slide counter. The
 * context is created by the render adapter (OffscreenCanvas) or injected; product code never
 * creates DOM. Only the canvas API subset below is used, so tests can pass a recording fake.
 */

export type Canvas2D = {
  fillStyle: unknown;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  /** Needed only for background images and their scrim. */
  globalAlpha?: number;
  drawImage?(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};

/** A decoded image a canvas can draw (an ImageBitmap in the browser). */
export type CoverImage = { source: unknown; width: number; height: number };

/** Source rectangle that makes an image cover a box (scaled to fill, centred, cropped). */
export function coverFit(image: { width: number; height: number }, box: { width: number; height: number }): { sx: number; sy: number; sw: number; sh: number } {
  const wider = image.width * box.height > box.width * image.height;
  const sw = wider ? (image.height * box.width) / box.height : image.width;
  const sh = wider ? image.height : (image.width * box.height) / box.width;
  return { sx: (image.width - sw) / 2, sy: (image.height - sh) / 2, sw, sh };
}

/** True when the context can draw the layout's background image. */
export function canDrawImages(context: Canvas2D): boolean {
  return typeof context.drawImage === 'function';
}

export type Surface = {
  context: Canvas2D;
  /** PNG bytes of what was drawn. */
  toPng(): Promise<Uint8Array>;
};

/** Creates a drawing surface, or undefined when this environment has no canvas. */
export type SurfaceFactory = (width: number, height: number) => Surface | undefined;

type OffscreenLike = {
  getContext(type: '2d'): Canvas2D | null;
  convertToBlob(options: { type: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
};

/** OffscreenCanvas when the browser has it (no DOM element is created). */
export const offscreenSurface: SurfaceFactory = (width, height) => {
  const Offscreen = (globalThis as { OffscreenCanvas?: new (width: number, height: number) => OffscreenLike }).OffscreenCanvas;
  if (!Offscreen) return undefined;
  const canvas = new Offscreen(width, height);
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  return {
    context,
    async toPng() {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
};

/**
 * Draws one slide. With `cover` (the article cover, decoded) and a layout whose data asks for it,
 * the image fills its box over the colour blocks, the scrim goes on top, the text uses the
 * layout's on-image colours and the photo's credit line is set where the data says. Returns
 * whether the image was drawn.
 */
export function drawSlide(
  context: Canvas2D,
  input: {
    template: CarouselTemplate;
    render: TemplateRender;
    slide: Slide;
    index: number;
    total: number;
    laid: readonly LaidSlot[];
    scale: number;
    cover?: CoverImage;
    /** Credit line of the cover ("Foto: Ana Prado"), set where the layout's image data says. */
    coverCredit?: string;
    /** Template typeface → the family the page loaded (`Typefaces`). */
    typefaces?: Typefaces;
  },
): boolean {
  const { template, render, slide, scale, typefaces } = input;
  const layout = render.layouts[slide.layout];
  if (!layout) return false;
  const px = (value: number) => Math.round(value * scale);

  context.fillStyle = layout.background;
  context.fillRect(0, 0, px(template.width), px(template.height));
  for (const shape of layout.shapes ?? []) {
    context.fillStyle = shape.color;
    context.fillRect(px(shape.x), px(shape.y), px(shape.width), px(shape.height));
  }
  const image = layout.image;
  const withImage = Boolean(image && input.cover && input.cover.width > 0 && input.cover.height > 0 && canDrawImages(context));
  if (image && input.cover && withImage) {
    const box = { x: px(image.x), y: px(image.y), width: px(image.width), height: px(image.height) };
    const source = coverFit(input.cover, image);
    context.drawImage?.(input.cover.source, source.sx, source.sy, source.sw, source.sh, box.x, box.y, box.width, box.height);
    for (const scrim of image.scrim) {
      context.globalAlpha = Math.min(1, Math.max(0, scrim.opacity));
      context.fillStyle = scrim.color;
      context.fillRect(px(scrim.x), px(scrim.y), px(scrim.width), px(scrim.height));
    }
    context.globalAlpha = 1;
  }
  if (layout.rule !== false) {
    context.fillStyle = layout.accent;
    context.fillRect(px(MARGIN), px(64), px(96), px(10));
  }
  context.textBaseline = 'top';
  for (const mark of layout.marks ?? []) {
    context.font = cssFont({ fontFamily: mark.fontFamily ?? BASE_FAMILY, fontWeight: mark.fontWeight, fontSize: mark.fontSize }, scale, typefaces);
    context.fillStyle = mark.color;
    context.textAlign = 'left';
    context.fillText(mark.text, px(mark.x), px(mark.y));
  }
  if (layout.number) {
    const number = layout.number;
    context.font = cssFont({ fontFamily: BASE_FAMILY, fontWeight: number.fontWeight, fontSize: number.fontSize }, scale, typefaces);
    context.fillStyle = number.color;
    context.textAlign = number.align ?? 'right';
    context.fillText(String(input.index + 1).padStart(2, '0'), px(number.x), px(number.y));
  }

  context.textBaseline = 'top';
  for (const slot of input.laid) {
    if (!slot.style.color) continue;
    const font = cssFont(slot.style, scale, typefaces);
    context.font = font;
    context.fillStyle = (withImage ? image?.slotColors?.[slot.spec.id] : undefined) ?? slot.style.color;
    context.textAlign = slot.style.align;
    const x = slot.style.align === 'center' ? slot.style.x + slot.style.width / 2 : slot.style.x;
    const visible = slot.lines.slice(0, slot.maxLines);
    if (slot.lines.length > slot.maxLines && visible.length > 0) {
      const measure = (text: string) => context.measureText(text).width / scale;
      visible[visible.length - 1] = ellipsize(visible[visible.length - 1], slot.style.width, measure);
    }
    visible.forEach((line, row) => context.fillText(line, px(x), px(slot.style.y + row * slot.style.lineHeight)));
  }

  const credit = withImage ? image?.credit : undefined;
  if (credit && input.coverCredit) {
    context.font = cssFont({ fontFamily: BASE_FAMILY, fontWeight: credit.fontWeight, fontSize: credit.fontSize }, scale, typefaces);
    context.fillStyle = credit.color;
    context.textAlign = credit.align;
    const measure = (text: string) => context.measureText(text).width / scale;
    const line = measure(input.coverCredit) <= credit.width ? input.coverCredit : ellipsize(input.coverCredit, credit.width, measure);
    context.fillText(line, px(credit.x), px(credit.y));
  }

  context.font = cssFont({ fontFamily: BASE_FAMILY, fontWeight: 600, fontSize: 28 }, scale, typefaces);
  context.fillStyle = (withImage ? image?.counterColor : undefined) ?? layout.counterColor ?? layout.accent;
  context.textAlign = 'right';
  context.fillText(`${input.index + 1}/${input.total}`, px(template.width - MARGIN), px(template.height - MARGIN));
  return withImage;
}
