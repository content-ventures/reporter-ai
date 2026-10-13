import type { CarouselTemplate, SlotSpec } from '../../../domain/carousel.ts';
import type { SlotStyle, TemplateRender } from '../../../ports/render-template.ts';

/**
 * Template DATA the local renderer draws: background, colour blocks, marks and one text box per
 * slot, in canvas pixels. The values (colours and typefaces included) are creative content and
 * live with the fixtures (`src/fixtures/templates/`, PLAN §4.1); Marketing's templates (D07)
 * replace them as data. The data types are shared through `ports/render-template.ts`.
 */

export type {
  CounterStyle,
  CreditStyle,
  LayoutImage,
  LayoutRender,
  ListStyle,
  MarkStyle,
  NumberStyle,
  ScrimStyle,
  ShapeStyle,
  SlotStyle,
  TemplateRender,
} from '../../../ports/render-template.ts';

/** Generic sans-serif fallbacks after the template font (the canvas may not have it loaded). */
export const FONT_FALLBACK = '"Helvetica Neue", Arial, sans-serif';

/** Serif typefaces a template may name (system faces); they fall back to a serif, not a sans. */
const SERIF_FAMILIES = new Set(['Georgia', 'Times New Roman', 'Charter', 'Iowan Old Style', 'Palatino']);
const SERIF_FALLBACK = '"Times New Roman", serif';

/** The generic fallback that keeps a typeface's genre when the face is missing. */
export function fallbackFor(family: string): string {
  return SERIF_FAMILIES.has(family) ? SERIF_FALLBACK : FONT_FALLBACK;
}

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
  const family = typefaces?.[style.fontFamily] ?? (/[\s"]/.test(style.fontFamily) ? `"${style.fontFamily.replace(/"/g, '')}"` : style.fontFamily);
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${family}, ${fallbackFor(style.fontFamily)}`;
}

/** Every face a template's data draws with (weight, style), as CSS fonts to load before drawing. */
export function templateFonts(render: TemplateRender | undefined, typefaces?: Typefaces): string[] {
  if (!render) return [];
  const fonts = new Set<string>();
  const add = (style: Pick<SlotStyle, 'fontFamily' | 'fontWeight' | 'italic'>) => fonts.add(cssFont({ ...style, fontSize: 16 }, 1, typefaces));
  for (const layout of Object.values(render.layouts)) {
    for (const slot of Object.values(layout.slots)) {
      add(slot);
      if (slot.list) add({ fontFamily: slot.list.fontFamily ?? slot.fontFamily, fontWeight: slot.list.fontWeight });
    }
    for (const mark of layout.marks ?? []) add({ fontFamily: mark.fontFamily ?? BASE_FAMILY, fontWeight: mark.fontWeight, ...(mark.italic ? { italic: true } : {}) });
    if (layout.number) add({ fontFamily: layout.number.fontFamily ?? BASE_FAMILY, fontWeight: layout.number.fontWeight });
    if (layout.image?.credit) add({ fontFamily: BASE_FAMILY, fontWeight: layout.image.credit.fontWeight });
    if (layout.counter) add({ fontFamily: layout.counter.fontFamily ?? BASE_FAMILY, fontWeight: layout.counter.fontWeight });
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
  const fontSize = slot.role === 'title' ? 72 : slot.role === 'stat' ? 160 : slot.role === 'kicker' || slot.role === 'cta' || slot.role === 'attribution' ? 34 : 46;
  const lineHeight = Math.round(fontSize * 1.2);
  const lines = slot.maxLines ?? 4;
  return {
    x: MARGIN,
    y: MARGIN * 2 + index * (lineHeight * lines + 48),
    width: template.width - MARGIN * 2,
    height: lineHeight * lines,
    fontFamily: BASE_FAMILY,
    fontWeight: slot.role === 'title' || slot.role === 'stat' ? 600 : 400,
    fontSize,
    lineHeight,
    color: render?.layouts[layoutId]?.accent ?? '',
    align: 'left',
  };
}
