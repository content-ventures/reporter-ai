import { findLayout } from '../../../domain/carousel.ts';
import type { CarouselTemplate, Slide, SlotSpec } from '../../../domain/carousel.ts';
import type { SlotFit } from '../../../ports/render.ts';
import { slotStyle } from './templates.ts';
import type { SlotStyle, TemplateRender } from './templates.ts';
import { wrapLines } from './text-metrics.ts';
import type { MeasureText } from './text-metrics.ts';

/**
 * Lays a slide's slot texts into their boxes: wrapped lines, allowed lines and the APPROXIMATE
 * fit the studio shows ("≈ Título excede 2 linhas"). Pure; drawing reuses the same lines.
 */

export type LaidSlot = { spec: SlotSpec; style: SlotStyle; text: string; lines: string[]; maxLines: number; fit: SlotFit };

/** What the slot shows: quotes get quotation marks, attributions a dash (decoration, not data). */
export function displayText(spec: SlotSpec, raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (spec.role === 'quote' && !/^[“"«]/.test(text)) return `“${text}”`;
  if (spec.role === 'attribution' && !/^[—–-]/.test(text)) return `— ${text}`;
  return text;
}

function linesWord(count: number): string {
  return count === 1 ? 'linha' : 'linhas';
}

export function laySlide(slide: Slide, template: CarouselTemplate, render: TemplateRender | undefined, measure: MeasureText): LaidSlot[] {
  const layout = findLayout(template, slide.layout);
  if (!layout) return [];
  const laid: LaidSlot[] = [];
  layout.slots.forEach((spec, index) => {
    const text = displayText(spec, slide.slots[spec.id] ?? '');
    if (!text) return;
    const style = slotStyle(template, render, layout.id, spec, index);
    const font = { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight, ...(style.italic ? { italic: true } : {}) };
    const lines = wrapLines(text, style.width, (value) => measure(value, font));
    const boxLines = Math.max(1, Math.floor(style.height / style.lineHeight));
    const maxLines = Math.min(spec.maxLines ?? boxLines, boxLines);
    const overflow = lines.length > maxLines;
    const fit: SlotFit = { slideId: slide.id, slotId: spec.id, label: spec.label, lines: lines.length, maxLines, overflow, approximate: true };
    if (overflow) fit.message = `≈ ${spec.label} excede ${maxLines} ${linesWord(maxLines)}`;
    laid.push({ spec, style, text, lines, maxLines, fit });
  });
  return laid;
}
