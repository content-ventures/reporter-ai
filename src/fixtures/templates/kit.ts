import type { CounterStyle, ListStyle, MarkStyle, NumberStyle, ScrimStyle, ShapeStyle, SlotStyle, TextAlign } from '../../ports/render-template.ts';

/**
 * Small builders for template render data: text boxes sized by the lines they hold, faces and
 * flat shapes. Creative content only (fixtures); the renderer reads the plain data they return.
 * Typefaces: Inter (loaded by the page through the DS, 400/500/600 and italics) and Georgia (a
 * system serif; the renderer falls back to a serif where it is missing).
 */

export const INTER = 'Inter';
export const GEORGIA = 'Georgia';

export type Face = { family: string; weight: number; italic?: boolean };

export const sans = (weight: number, italic = false): Face => ({ family: INTER, weight, ...(italic ? { italic: true } : {}) });
export const serif = (weight: number, italic = false): Face => ({ family: GEORGIA, weight, ...(italic ? { italic: true } : {}) });

export type TextOptions = {
  align?: TextAlign;
  valign?: SlotStyle['valign'];
  uppercase?: boolean;
  tracking?: number;
  /** Line height as a multiple of the size (default 1.2). */
  leading?: number;
  /** Box height in lines (default: the lines the slot allows; more leaves room for valign). */
  room?: number;
  list?: Omit<ListStyle, 'gap'> & { gap?: number };
};

/**
 * A text box at (x, y) that holds `lines` lines (or `room` lines when given): its height is
 * derived from the size and leading, so a box always holds the lines its slot allows.
 */
export function text(x: number, y: number, width: number, lines: number, size: number, face: Face, color: string, options: TextOptions = {}): SlotStyle {
  const lineHeight = Math.round(size * (options.leading ?? 1.2));
  const rows = Math.max(lines, options.room ?? lines);
  const gap = options.list?.gap ?? 0;
  const style: SlotStyle = {
    x,
    y,
    width,
    height: rows * lineHeight + Math.max(0, rows - 1) * gap,
    fontFamily: face.family,
    fontWeight: face.weight,
    fontSize: size,
    lineHeight,
    color,
    align: options.align ?? 'left',
  };
  if (face.italic) style.italic = true;
  if (options.valign) style.valign = options.valign;
  if (options.uppercase) style.uppercase = true;
  if (options.tracking) style.tracking = options.tracking;
  if (options.list) style.list = { ...options.list, gap };
  return style;
}

/** Bottom edge of a box (to stack the next one under it). */
export const below = (style: SlotStyle, space = 0): number => style.y + style.height + space;

export const rect = (x: number, y: number, width: number, height: number, color: string): ShapeStyle => ({ x, y, width, height, color });

export function mark(value: string, x: number, y: number, size: number, face: Face, color: string, align?: TextAlign): MarkStyle {
  return { text: value, x, y, fontSize: size, fontWeight: face.weight, color, fontFamily: face.family, ...(face.italic ? { italic: true } : {}), ...(align ? { align } : {}) };
}

export function slideNumber(x: number, y: number, size: number, face: Face, color: string, align: TextAlign = 'right'): NumberStyle {
  return { x, y, fontSize: size, fontWeight: face.weight, color, align, fontFamily: face.family };
}

export function counter(x: number, y: number, align: TextAlign, size: number, face: Face, color: string, tracking?: number): CounterStyle {
  return { x, y, align, fontSize: size, fontWeight: face.weight, color, fontFamily: face.family, ...(tracking ? { tracking } : {}) };
}

/**
 * A darkening ramp over a photo, built from flat bands that overlap (no gradient in the data):
 * `steps` bands of the same opacity reach `opacity` where they all overlap. `down` darkens from
 * `from` (clear) to `to` (full) and keeps it to the bottom of `height`; `up` is full from the top
 * down to `from` and clears at `to`.
 */
export function ramp(direction: 'down' | 'up', from: number, to: number, height: number, color: string, opacity: number, steps = 40): ScrimStyle[] {
  const each = 1 - Math.pow(1 - opacity, 1 / steps);
  const step = (to - from) / steps;
  return Array.from({ length: steps }, (_, index) => {
    const edge = Math.round(direction === 'down' ? from + index * step : to - index * step);
    return direction === 'down'
      ? { ...rect(0, edge, 1080, height - edge, color), opacity: Number(each.toFixed(4)) }
      : { ...rect(0, 0, 1080, edge, color), opacity: Number(each.toFixed(4)) };
  });
}

/** Canvas of a format. */
export type Canvas = { width: number; height: number; margin: number };

export const FEED: Canvas = { width: 1080, height: 1350, margin: 96 };
export const SQUARE: Canvas = { width: 1080, height: 1080, margin: 88 };

/** Width between the side margins. */
export const inner = (canvas: Canvas): number => canvas.width - canvas.margin * 2;
