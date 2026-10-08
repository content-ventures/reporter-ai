import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, ShapeStyle, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, slideNumber, text } from '../kit.ts';

/**
 * Números (Dados, Feed 4:5): figures first. A cobalt cover with a rising bar motif, light pages
 * where the figure is the headline, a quote on cobalt and a navy closing with the call on a
 * cobalt band. Features the `data` layout: the generation turns a point with a figure into one.
 */
export type DataPalette = { page: string; ink: string; muted: string; accent: string; onAccent: string; tint: string; bar: string; deep: string; onDeep: string };

/** Rising bars, bottom-aligned at `bottom`, right-aligned at `right`. */
function bars(right: number, bottom: number, width: number, gap: number, heights: readonly number[], color: string): ShapeStyle[] {
  const total = heights.length * width + (heights.length - 1) * gap;
  return heights.map((height, index) => rect(right - total + index * (width + gap), bottom - height, width, height, color));
}

export function dataFeed(templateId: TemplateId, palette: DataPalette): TemplateRender {
  const page = { background: palette.page, accent: palette.accent, rule: false };
  const number = slideNumber(96, 92, 120, sans(600), palette.accent, 'left');
  const pageCounter = counter(984, 1254, 'right', 28, sans(600), palette.muted);
  const motif = bars(984, 1180, 40, 16, [80, 130, 190], palette.tint);
  const listMarker = { marker: 'number' as const, indent: 104, color: palette.accent, fontWeight: 600, gap: 28 };
  const inner = (titleColor: string, bodyColor: string): LayoutRender => ({
    ...page,
    number,
    shapes: motif,
    counter: pageCounter,
    slots: {
      title: text(96, 330, 888, 2, 66, sans(600), titleColor, { leading: 1.1 }),
      body: text(96, 530, 888, 6, 46, sans(400), bodyColor, { leading: 1.3 }),
    },
  });
  const layouts: Record<string, LayoutRender> = {
    cover: {
      background: palette.accent,
      accent: palette.onAccent,
      rule: false,
      shapes: bars(984, 1180, 76, 24, [150, 250, 360, 480], palette.bar),
      counter: counter(984, 1254, 'right', 28, sans(600), palette.onAccent),
      slots: {
        kicker: text(96, 200, 888, 1, 30, sans(600), palette.tint, { uppercase: true, tracking: 4, leading: 1.4 }),
        title: text(96, 290, 888, 4, 92, sans(600), palette.onAccent, { leading: 1.06 }),
      },
    },
    context: inner(palette.ink, palette.muted),
    point: inner(palette.accent, palette.ink),
    data: {
      ...page,
      shapes: bars(984, 1180, 56, 20, [100, 170, 240], palette.tint),
      counter: pageCounter,
      slots: {
        title: text(96, 250, 888, 2, 34, sans(600), palette.muted, { uppercase: true, tracking: 3, leading: 1.35 }),
        stat: text(96, 380, 888, 1, 220, sans(600), palette.accent, { leading: 1.05 }),
        body: text(96, 660, 888, 4, 52, sans(500), palette.ink, { leading: 1.22 }),
      },
    },
    list: {
      ...page,
      number,
      counter: pageCounter,
      slots: {
        title: text(96, 300, 888, 2, 62, sans(600), palette.ink, { leading: 1.1 }),
        items: text(96, 500, 888, 6, 44, sans(400), palette.ink, { list: listMarker, leading: 1.25 }),
      },
    },
    quote: {
      background: palette.accent,
      accent: palette.onAccent,
      rule: false,
      marks: [mark('“', 80, 40, 380, sans(600), palette.tint)],
      counter: counter(984, 1254, 'right', 28, sans(600), palette.onAccent),
      slots: {
        quote: text(96, 420, 888, 5, 62, sans(500, true), palette.onAccent, { leading: 1.2 }),
        attribution: text(96, 1020, 888, 2, 32, sans(600), palette.tint, { leading: 1.3 }),
      },
    },
    closing: {
      background: palette.deep,
      accent: palette.accent,
      rule: false,
      number: slideNumber(96, 92, 120, sans(600), palette.tint, 'left'),
      shapes: [rect(0, 1110, 1080, 240, palette.accent)],
      counter: counter(984, 1254, 'right', 28, sans(600), palette.onAccent),
      slots: {
        title: text(96, 330, 888, 2, 74, sans(600), palette.onDeep, { leading: 1.08 }),
        body: text(96, 540, 888, 5, 44, sans(400), palette.tint, { leading: 1.32 }),
        cta: text(96, 1180, 700, 1, 32, sans(600), palette.onAccent, { uppercase: true, tracking: 3, leading: 1.4 }),
      },
    },
  };
  return { templateId, layouts };
}
