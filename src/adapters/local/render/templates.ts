import type { CarouselTemplate, SlotSpec } from '../../../domain/carousel.ts';
import type { TemplateId } from '../../../domain/ids.ts';

/**
 * Template DATA the local renderer draws: background, accent and one text box per slot, in
 * canvas pixels. The values (colours included) are creative content and live with the fixtures
 * (`src/fixtures/templates/`, PLAN §4.1); Marketing's templates (D07) replace them as data.
 * These types are structural, so the fixtures' `TemplateRender` plugs in as is.
 */

export type SlotStyle = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  align: 'left' | 'center';
  italic?: boolean;
};

/** A flat colour block of the creative (bleed band, panel), in canvas pixels. */
export type ShapeStyle = { x: number; y: number; width: number; height: number; color: string };

/** A typographic mark of the creative (the big “ of the quote slide). */
export type MarkStyle = { text: string; x: number; y: number; fontSize: number; fontWeight: number; color: string; fontFamily?: string };

/** The slide number set large ("02"), as part of the layout. */
export type NumberStyle = { x: number; y: number; fontSize: number; fontWeight: number; color: string; align?: 'left' | 'right' };

/** A flat colour block drawn with transparency over a background image (legibility scrim). */
export type ScrimStyle = ShapeStyle & { opacity: number };

/**
 * Template data asking for an image under the text. `background: 'article-cover'` draws the
 * cover of the article version the carousel was made from, cover-fit (scaled to fill the box,
 * centred, cropped), then the scrim; text fit never depends on it. Without a cover the layout is
 * drawn as usual (colours and shapes).
 */
export type LayoutImage = {
  background: 'article-cover';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Legibility scrim over the image, under the text (template colours). */
  scrim: ScrimStyle[];
  /** Slot colours while the image is drawn (text set on the photo). */
  slotColors?: Record<string, string>;
  /** Colour of the "2/5" counter while the image is drawn. */
  counterColor?: string;
  /** Where the photo's credit line ("Foto: Ana Prado") is set while the image is drawn. */
  credit?: CreditStyle;
};

/** A one-line text over the image (the credit), ellipsized to `width`; `x` is its anchor for `align`. */
export type CreditStyle = { x: number; y: number; width: number; fontSize: number; fontWeight: number; color: string; align: 'left' | 'right' };

export type LayoutRender = {
  background: string;
  accent: string;
  slots: Record<string, SlotStyle>;
  /** Background image under the text (template data decides; see `LayoutImage`). */
  image?: LayoutImage;
  /** Colour blocks under the text. */
  shapes?: ShapeStyle[];
  /** Typographic marks under the text. */
  marks?: MarkStyle[];
  /** Large slide number. */
  number?: NumberStyle;
  /** The short accent rule at the top (default shown). */
  rule?: boolean;
  /** Colour of the "2/5" counter (default: accent). */
  counterColor?: string;
};

export type TemplateRender = {
  templateId: TemplateId;
  /** Placeholder until Marketing's templates arrive (D07). */
  provisional: boolean;
  layouts: Record<string, LayoutRender>;
};

/** Generic sans-serif fallbacks after the template font (the canvas may not have it loaded). */
export const FONT_FALLBACK = '"Helvetica Neue", Arial, sans-serif';

/** Side margin used by fallback boxes and decorations (canvas pixels at template size). */
export const MARGIN = 96;

/** Family of the template's decorations (number, counter, credit): the creatives' typeface. */
export const BASE_FAMILY = 'Inter';

/**
 * Template typeface (creative data: "Inter") → the CSS family the page actually loaded for it
 * (the DS registers Inter under its own name). Without an entry the template name is used as is,
 * which only matches a font installed on the machine.
 */
export type Typefaces = Readonly<Record<string, string>>;

export function cssFont(style: Pick<SlotStyle, 'fontFamily' | 'fontWeight' | 'fontSize' | 'italic'>, scale = 1, typefaces?: Typefaces): string {
  const size = Math.max(1, Math.round(style.fontSize * scale));
  const family = typefaces?.[style.fontFamily] ?? style.fontFamily;
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${family}, ${FONT_FALLBACK}`;
}

/** Every face a template's data draws with (weight, style), as CSS fonts to load before drawing. */
export function templateFonts(render: TemplateRender | undefined, typefaces?: Typefaces): string[] {
  if (!render) return [];
  const fonts = new Set<string>();
  const add = (style: Pick<SlotStyle, 'fontFamily' | 'fontWeight' | 'italic'>) => fonts.add(cssFont({ ...style, fontSize: 16 }, 1, typefaces));
  for (const layout of Object.values(render.layouts)) {
    for (const slot of Object.values(layout.slots)) add(slot);
    for (const mark of layout.marks ?? []) add({ fontFamily: mark.fontFamily ?? BASE_FAMILY, fontWeight: mark.fontWeight });
    if (layout.number) add({ fontFamily: BASE_FAMILY, fontWeight: layout.number.fontWeight });
    if (layout.image?.credit) add({ fontFamily: BASE_FAMILY, fontWeight: layout.image.credit.fontWeight });
  }
  add({ fontFamily: BASE_FAMILY, fontWeight: 600 });
  return [...fonts];
}

/**
 * Box of a slot. A slot the template data does not style gets a full-width box drawn in the
 * layout's accent, so a new layout never breaks measuring (its fit is still approximate).
 * No colour is invented here: without layout data the slide is measured but not rasterised.
 */
export function slotStyle(template: CarouselTemplate, render: TemplateRender | undefined, layoutId: string, slot: SlotSpec, index: number): SlotStyle {
  const styled = render?.layouts[layoutId]?.slots[slot.id];
  if (styled) return styled;
  const fontSize = slot.role === 'title' ? 72 : slot.role === 'kicker' || slot.role === 'cta' || slot.role === 'attribution' ? 34 : 46;
  const lineHeight = Math.round(fontSize * 1.2);
  const lines = slot.maxLines ?? 4;
  return {
    x: MARGIN,
    y: MARGIN * 2 + index * (lineHeight * lines + 48),
    width: template.width - MARGIN * 2,
    height: lineHeight * lines,
    fontFamily: BASE_FAMILY,
    fontWeight: slot.role === 'title' ? 700 : 400,
    fontSize,
    lineHeight,
    color: render?.layouts[layoutId]?.accent ?? '',
    align: 'left',
  };
}
