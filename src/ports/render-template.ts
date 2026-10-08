import type { TemplateMeta } from '../domain/carousel-library.ts';
import type { TemplateId } from '../domain/ids.ts';

/**
 * Visual DATA of a carousel template, as the local renderer draws it, in canvas pixels at the
 * template size (1080 × 1350 for Feed, 1080 × 1080 for Quadrado). Creative content, not UI: the
 * colours and typefaces live in the template catalogue (`src/fixtures/templates/`), never in the
 * interface, and Marketing's approved models arrive as more of the same data. A vendor renderer
 * (Canva, Bannerbear…) reads its own data instead. Shared by the catalogue (which writes it) and
 * the local renderer (which draws it), so neither copies the other's types.
 */

export type TextAlign = 'left' | 'center' | 'right';

/** A list slot: one item per line break, each with its marker ("01", "•") in a hanging indent. */
export type ListStyle = {
  marker: 'number' | 'bullet';
  /** Item text starts this far from the box's left edge; the marker sits in that space. */
  indent: number;
  /** Extra space between items. */
  gap: number;
  color: string;
  fontWeight: number;
  fontFamily?: string;
};

/** Text style of one slot box. */
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
  align: TextAlign;
  italic?: boolean;
  /** Where the lines sit in the box: top (default), middle or bottom (a title over a photo). */
  valign?: 'top' | 'middle' | 'bottom';
  /** Set in capitals (calls, labels); measured as drawn. */
  uppercase?: boolean;
  /** Letter spacing, in canvas pixels. */
  tracking?: number;
  /** List slots: items with markers in a hanging indent. */
  list?: ListStyle;
};

/** A flat colour block of the creative (bleed band, panel, hairline), in canvas pixels. */
export type ShapeStyle = { x: number; y: number; width: number; height: number; color: string };

/** A typographic mark of the creative (the big “ of a quote slide, an arrow), drawn under the text. */
export type MarkStyle = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  color: string;
  fontFamily?: string;
  italic?: boolean;
  align?: TextAlign;
};

/** The slide number set large ("02"), as part of the layout. */
export type NumberStyle = { x: number; y: number; fontSize: number; fontWeight: number; color: string; align?: TextAlign; fontFamily?: string };

/** The page counter ("2/5"); `false` on a layout leaves it out. */
export type CounterStyle = {
  x: number;
  y: number;
  align: TextAlign;
  fontSize: number;
  fontWeight: number;
  color: string;
  fontFamily?: string;
  tracking?: number;
};

/** A flat colour block drawn with transparency over a background image (legibility scrim). */
export type ScrimStyle = ShapeStyle & { opacity: number };

/** A one-line text over the image (the credit), ellipsized to `width`; `x` is its anchor for `align`. */
export type CreditStyle = { x: number; y: number; width: number; fontSize: number; fontWeight: number; color: string; align: 'left' | 'right' };

/**
 * Template data asking for an image under the text. `background: 'article-cover'` draws the
 * cover of the article version the carousel was made from, cover-fit (scaled to fill the box,
 * centred, cropped), then the scrim; text fit never depends on it. Without a cover the layout is
 * drawn as usual (colours and shapes), so every layout must also read well without the photo.
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

export type LayoutRender = {
  background: string;
  accent: string;
  slots: Record<string, SlotStyle>;
  /** Background image under the text (template data decides; see `LayoutImage`). */
  image?: LayoutImage;
  /** Colour blocks under the text. */
  shapes?: ShapeStyle[];
  /** Colour blocks drawn over the image (a band that must stay solid on the photo). */
  overlays?: ShapeStyle[];
  /** Typographic marks under the text. */
  marks?: MarkStyle[];
  /** Large slide number. */
  number?: NumberStyle;
  /** The short accent rule at the top (default shown). */
  rule?: boolean;
  /** Colour of the default "2/5" counter (default: accent). */
  counterColor?: string;
  /** Where and how the counter is set; `false` leaves it out. Default: bottom right, 28 px. */
  counter?: CounterStyle | false;
};

/** The visual data of one template: one `LayoutRender` per layout id. Its status lives in the library metadata. */
export type TemplateRender = {
  templateId: TemplateId;
  layouts: Record<string, LayoutRender>;
};

/** Sample copy of a template, per layout id then slot id: what the library previews show. */
export type SampleContent = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Library data of a template: the card's metadata and the sample copy of its previews. */
export type TemplateLibraryData = { meta: TemplateMeta; sample: SampleContent };
