import { findLayout, listItems } from '../../../domain/carousel.ts';
import type { CarouselTemplate, Slide, SlotSpec } from '../../../domain/carousel.ts';
import type { SlotFit } from '../../../ports/render.ts';
import { slotStyle } from './templates.ts';
import type { SlotStyle, TemplateRender } from './templates.ts';
import { wrapLines } from './text-metrics.ts';
import type { MeasureText } from './text-metrics.ts';

/**
 * Lays a slide's slot texts into their boxes: wrapped lines, allowed lines and the APPROXIMATE
 * fit the studio shows ("≈ Título excede 2 linhas"). Pure; drawing reuses the same lines. A list
 * slot sets one item per line break, each wrapped inside a hanging indent with its marker.
 */

/** One line as drawn: offsets from the box's top-left; an item's first line carries its marker. */
export type LaidRow = { text: string; indent: number; top: number; marker?: string };

export type LaidSlot = { spec: SlotSpec; style: SlotStyle; text: string; lines: string[]; rows: LaidRow[]; maxLines: number; fit: SlotFit };

/**
 * What the slot shows: quotes get quotation marks, attributions a dash, capitals where the
 * template sets them (decoration, not data: the stored text never changes).
 */
export function displayText(spec: SlotSpec, raw: string, style?: Pick<SlotStyle, 'uppercase'>): string {
  let text = raw.trim();
  if (!text) return '';
  if (spec.role === 'quote' && !/^[“"«]/.test(text)) text = `“${text}”`;
  else if (spec.role === 'attribution' && !/^[—–-]/.test(text)) text = `— ${text}`;
  return style?.uppercase ? text.toLocaleUpperCase('pt-BR') : text;
}

function linesWord(count: number): string {
  return count === 1 ? 'linha' : 'linhas';
}

function markerFor(style: NonNullable<SlotStyle['list']>, index: number): string {
  return style.marker === 'number' ? String(index + 1).padStart(2, '0') : '•';
}

/** Rows of a list slot and how many rows its box holds (gaps between items included). */
function listRows(text: string, style: SlotStyle, list: NonNullable<SlotStyle['list']>, measure: (text: string) => number): { rows: LaidRow[]; capacity: number } {
  const rows: LaidRow[] = [];
  let top = 0;
  listItems(text).forEach((item, index) => {
    if (index > 0) top += list.gap;
    wrapLines(item, style.width - list.indent, measure).forEach((line, row) => {
      rows.push({ text: line, indent: list.indent, top, ...(row === 0 ? { marker: markerFor(list, index) } : {}) });
      top += style.lineHeight;
    });
  });
  const inside = rows.filter((row) => row.top + style.lineHeight <= style.height + 0.5).length;
  const last = rows[rows.length - 1];
  const room = inside === rows.length && last ? Math.max(0, Math.floor((style.height - (last.top + style.lineHeight)) / style.lineHeight)) : 0;
  return { rows, capacity: Math.max(1, inside + room) };
}

export function laySlide(slide: Slide, template: CarouselTemplate, render: TemplateRender | undefined, measure: MeasureText): LaidSlot[] {
  const layout = findLayout(template, slide.layout);
  if (!layout) return [];
  const laid: LaidSlot[] = [];
  layout.slots.forEach((spec, index) => {
    const style = slotStyle(template, render, layout.id, spec, index);
    const text = displayText(spec, slide.slots[spec.id] ?? '', style);
    if (!text) return;
    const font = { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, ...(style.italic ? { italic: true } : {}), ...(style.tracking ? { tracking: style.tracking } : {}) };
    const width = (value: string) => measure(value, font);
    let rows: LaidRow[];
    let boxLines: number;
    if (style.list) {
      const listed = listRows(text, style, style.list, width);
      rows = listed.rows;
      boxLines = listed.capacity;
    } else {
      rows = wrapLines(text, style.width, width).map((line, row) => ({ text: line, indent: 0, top: row * style.lineHeight }));
      boxLines = Math.max(1, Math.floor(style.height / style.lineHeight));
    }
    const lines = rows.map((row) => row.text);
    const maxLines = Math.min(spec.maxLines ?? boxLines, boxLines);
    const overflow = lines.length > maxLines;
    const fit: SlotFit = { slideId: slide.id, slotId: spec.id, label: spec.label, lines: lines.length, maxLines, overflow, approximate: true };
    if (overflow) fit.message = `≈ ${spec.label} excede ${maxLines} ${linesWord(maxLines)}`;
    laid.push({ spec, style, text, lines, rows, maxLines, fit });
  });
  return laid;
}
