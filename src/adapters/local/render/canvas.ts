import type { CarouselTemplate, Slide } from '../../../domain/carousel.ts';
import type { LaidSlot } from './slide-layout.ts';
import { BASE_FAMILY, cssFont, MARGIN } from './templates.ts';
import type { TemplateRender, Typefaces } from './templates.ts';
import type { Radius, ShapeStyle, VectorStyle } from '../../../ports/render-template.ts';
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
  beginPath?(): void;
  moveTo?(x: number, y: number): void;
  lineTo?(x: number, y: number): void;
  closePath?(): void;
  /** Fills the current path, or the given `Path2D` (vector marks). */
  fill?(path?: unknown): void;
  /** Rounded boxes, outlines, clipped photos and vector marks; skipped where the canvas lacks them. */
  roundRect?(x: number, y: number, width: number, height: number, radii: number | number[]): void;
  strokeStyle?: unknown;
  lineWidth?: number;
  stroke?(): void;
  save?(): void;
  restore?(): void;
  clip?(): void;
  translate?(x: number, y: number): void;
  scale?(x: number, y: number): void;
  /** Needed only for background images and their scrim. */
  globalAlpha?: number;
  /** Letter spacing ("4px") where the canvas supports it; measuring sets it the same way. */
  letterSpacing?: string;
  drawImage?(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};

/** A decoded image a canvas can draw (an ImageBitmap in the browser). */
export type CoverImage = { source: unknown; width: number; height: number };

/** Source rectangle that makes an image cover a box (scaled to fill, centred, cropped). */
export function coverFit(image: { width: number; height: number }, box: { width: number; height: number }, position?: { x: number; y: number }): { sx: number; sy: number; sw: number; sh: number } {
  const wider = image.width * box.height > box.width * image.height;
  const sw = wider ? (image.height * box.width) / box.height : image.width;
  const sh = wider ? image.height : (image.width * box.height) / box.width;
  const anchor = (value: number | undefined) => value !== undefined && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  return { sx: (image.width - sw) * anchor(position?.x), sy: (image.height - sh) * anchor(position?.y), sw, sh };
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

/** Corner radii in drawn pixels, clamped to half the box's shorter side. */
function radii(radius: Radius, width: number, height: number, scale: number): number[] {
  const most = Math.min(width, height) / 2;
  return (typeof radius === 'number' ? [radius, radius, radius, radius] : [...radius]).map((value) => Math.min(most, Math.max(0, value * scale)));
}

/** Traces a rounded box as the current path; false where the canvas cannot. */
function roundedPath(context: Canvas2D, box: { x: number; y: number; width: number; height: number }, radius: Radius, scale: number): boolean {
  if (!context.beginPath || !context.roundRect) return false;
  context.beginPath();
  context.roundRect(box.x, box.y, box.width, box.height, radii(radius, box.width, box.height, scale));
  return true;
}

type PathFactory = new (d: string) => unknown;
const paths = new Map<string, unknown>();

/** Draws a vector mark (a logo's paths) scaled into place; skipped where the canvas has no `Path2D`. */
function drawVector(context: Canvas2D, vector: VectorStyle, scale: number): void {
  const Path = (globalThis as { Path2D?: PathFactory }).Path2D;
  if (!Path || !context.save || !context.restore || !context.translate || !context.scale || !context.fill) return;
  const factor = (vector.height / vector.viewBox.height) * scale;
  context.save();
  context.translate(Math.round(vector.x * scale), Math.round(vector.y * scale));
  context.scale(factor, factor);
  context.translate(-vector.viewBox.x, -vector.viewBox.y);
  for (const path of vector.paths) {
    let shape = paths.get(path.d);
    if (!shape) {
      shape = new Path(path.d);
      paths.set(path.d, shape);
    }
    context.fillStyle = path.color;
    context.fill(shape);
  }
  context.restore();
}

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
  const fill = (shape: ShapeStyle) => {
    context.fillStyle = shape.color;
    const box = { x: px(shape.x), y: px(shape.y), width: px(shape.width), height: px(shape.height) };
    if (shape.outline !== undefined) {
      if (!context.stroke || !roundedPath(context, box, shape.radius ?? 0, scale)) return;
      context.strokeStyle = shape.color;
      context.lineWidth = Math.max(1, shape.outline * scale);
      context.stroke();
      return;
    }
    if (shape.radius && !shape.points && context.fill && roundedPath(context, box, shape.radius, scale)) {
      context.fill();
      return;
    }
    if (shape.points && shape.points.length >= 3 && context.beginPath && context.moveTo && context.lineTo && context.closePath && context.fill) {
      context.beginPath();
      context.moveTo(px(shape.points[0].x), px(shape.points[0].y));
      for (const point of shape.points.slice(1)) context.lineTo(px(point.x), px(point.y));
      context.closePath();
      context.fill();
      return;
    }
    context.fillRect(box.x, box.y, box.width, box.height);
  };

  context.fillStyle = layout.background;
  context.fillRect(0, 0, px(template.width), px(template.height));
  for (const shape of layout.shapes ?? []) fill(shape);
  const image = layout.image;
  const withImage = Boolean(image && input.cover && input.cover.width > 0 && input.cover.height > 0 && canDrawImages(context));
  if (image && input.cover && withImage) {
    const box = { x: px(image.x), y: px(image.y), width: px(image.width), height: px(image.height) };
    const source = coverFit(input.cover, image, image.position);
    const clipped = Boolean(image.radius && context.save && context.restore && context.clip && roundedPath(context, box, image.radius, scale));
    if (clipped) {
      context.save?.();
      context.clip?.();
    }
    context.drawImage?.(input.cover.source, source.sx, source.sy, source.sw, source.sh, box.x, box.y, box.width, box.height);
    for (const scrim of image.scrim) {
      context.globalAlpha = Math.min(1, Math.max(0, scrim.opacity));
      context.fillStyle = scrim.color;
      context.fillRect(px(scrim.x), px(scrim.y), px(scrim.width), px(scrim.height));
    }
    context.globalAlpha = 1;
    if (clipped) context.restore?.();
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
    if (mark.tracking) context.letterSpacing = `${mark.tracking * scale}px`;
    context.fillText(mark.text, px(mark.x), px(mark.y));
    if (mark.tracking) context.letterSpacing = '0px';
  }
  for (const vector of layout.vectors ?? []) drawVector(context, vector, scale);
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
    const pill = style.pill;
    if (pill) {
      const ink = context.fillStyle;
      for (const row of visible) {
        // Letter spacing trails the last glyph too: leave it out so the band sits even.
        const width = measure(row.text) - (style.tracking ?? 0);
        const anchor = x(row.indent);
        const left = style.align === 'center' ? anchor - width / 2 : style.align === 'right' ? anchor - width : anchor;
        fill({ x: left - pill.padX, y: style.y + shift + row.top - pill.padY, width: width + pill.padX * 2, height: style.lineHeight + pill.padY * 2, color: pill.color, radius: pill.radius, ...(pill.outline !== undefined ? { outline: pill.outline } : {}) });
      }
      context.fillStyle = ink;
    }
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
    context.font = cssFont({ fontFamily: credit.fontFamily ?? BASE_FAMILY, fontWeight: credit.fontWeight, fontSize: credit.fontSize }, scale, typefaces);
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
