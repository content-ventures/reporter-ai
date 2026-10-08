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
  /** Letter spacing ("4px") where the canvas supports it; measuring sets it the same way. */
  letterSpacing?: string;
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
  const fill = (shape: { x: number; y: number; width: number; height: number; color: string }) => {
    context.fillStyle = shape.color;
    context.fillRect(px(shape.x), px(shape.y), px(shape.width), px(shape.height));
  };

  context.fillStyle = layout.background;
  context.fillRect(0, 0, px(template.width), px(template.height));
  for (const shape of layout.shapes ?? []) fill(shape);
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
  for (const shape of layout.overlays ?? []) fill(shape);
  if (layout.rule !== false) {
    context.fillStyle = layout.accent;
    context.fillRect(px(MARGIN), px(64), px(96), px(10));
  }
  context.textBaseline = 'top';
  for (const mark of layout.marks ?? []) {
    context.font = cssFont({ fontFamily: mark.fontFamily ?? BASE_FAMILY, fontWeight: mark.fontWeight, fontSize: mark.fontSize, ...(mark.italic ? { italic: true } : {}) }, scale, typefaces);
    context.fillStyle = mark.color;
    context.textAlign = mark.align ?? 'left';
    context.fillText(mark.text, px(mark.x), px(mark.y));
  }
  if (layout.number) {
    const number = layout.number;
    context.font = cssFont({ fontFamily: number.fontFamily ?? BASE_FAMILY, fontWeight: number.fontWeight, fontSize: number.fontSize }, scale, typefaces);
    context.fillStyle = number.color;
    context.textAlign = number.align ?? 'right';
    context.fillText(String(input.index + 1).padStart(2, '0'), px(number.x), px(number.y));
  }

  context.textBaseline = 'top';
  for (const slot of input.laid) {
    if (!slot.style.color) continue;
    const { style } = slot;
    context.font = cssFont(style, scale, typefaces);
    context.fillStyle = (withImage ? image?.slotColors?.[slot.spec.id] : undefined) ?? style.color;
    context.textAlign = style.align;
    if (style.tracking) context.letterSpacing = `${style.tracking * scale}px`;
    const visible = slot.rows.slice(0, slot.maxLines).map((row) => ({ ...row }));
    const measure = (text: string) => context.measureText(text).width / scale;
    const last = visible[visible.length - 1];
    if (slot.rows.length > slot.maxLines && last) last.text = ellipsize(last.text, style.width - last.indent, measure);
    const used = last ? last.top + style.lineHeight : 0;
    const shift = style.valign === 'bottom' ? style.height - used : style.valign === 'middle' ? (style.height - used) / 2 : 0;
    const x = (indent: number) => (style.align === 'center' ? style.x + indent + (style.width - indent) / 2 : style.align === 'right' ? style.x + style.width : style.x + indent);
    for (const row of visible) context.fillText(row.text, px(x(row.indent)), px(style.y + shift + row.top));
    if (style.tracking) context.letterSpacing = '0px';
    const list = style.list;
    if (list) {
      context.font = cssFont({ fontFamily: list.fontFamily ?? style.fontFamily, fontWeight: list.fontWeight, fontSize: style.fontSize }, scale, typefaces);
      context.fillStyle = list.color;
      context.textAlign = 'left';
      for (const row of visible) if (row.marker) context.fillText(row.marker, px(style.x), px(style.y + shift + row.top));
    }
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

  if (layout.counter !== false) {
    const counter = layout.counter;
    context.font = cssFont({ fontFamily: counter?.fontFamily ?? BASE_FAMILY, fontWeight: counter?.fontWeight ?? 600, fontSize: counter?.fontSize ?? 28 }, scale, typefaces);
    context.fillStyle = (withImage ? image?.counterColor : undefined) ?? counter?.color ?? layout.counterColor ?? layout.accent;
    context.textAlign = counter?.align ?? 'right';
    if (counter?.tracking) context.letterSpacing = `${counter.tracking * scale}px`;
    context.fillText(`${input.index + 1}/${input.total}`, px(counter?.x ?? template.width - MARGIN), px(counter?.y ?? template.height - MARGIN));
    if (counter?.tracking) context.letterSpacing = '0px';
  }
  return withImage;
}
