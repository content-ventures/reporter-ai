import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, serif, slideNumber, text } from '../kit.ts';

/**
 * Revista (Feed 4:5): a printed page. Serif display type on paper, hairlines that frame each page
 * like a masthead and a folio, small capitals in the accent for labels, the folio number in
 * italic. Typographic only: no photo, so it reads the same with or without the article image.
 */
export type MagazinePalette = { paper: string; ink: string; muted: string; accent: string };

export function magazineFeed(templateId: TemplateId, palette: MagazinePalette): TemplateRender {
  const base = { background: palette.paper, accent: palette.accent, rule: false };
  const frame = [rect(96, 150, 888, 2, palette.ink), rect(96, 1180, 888, 2, palette.ink)];
  const folio = slideNumber(984, 92, 40, serif(400, true), palette.accent, 'right');
  const pageCounter = counter(96, 1210, 'left', 30, serif(400, true), palette.muted);
  const label = (y: number) => text(96, y, 888, 2, 26, sans(600), palette.accent, { uppercase: true, tracking: 5, leading: 1.4 });
  const listMarker = { marker: 'number' as const, indent: 96, color: palette.accent, fontWeight: 600, fontFamily: 'Inter', gap: 26 };
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...base,
      shapes: frame,
      counter: pageCounter,
      slots: {
        kicker: text(96, 92, 888, 1, 26, sans(600), palette.accent, { uppercase: true, tracking: 6, leading: 1.4 }),
        title: text(96, 236, 888, 4, 96, serif(400), palette.ink, { leading: 1.08, valign: 'middle', room: 8 }),
      },
    },
    context: {
      ...base,
      shapes: [...frame, rect(96, 430, 72, 5, palette.accent)],
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(96, 236, 888, 2, 70, serif(400), palette.ink, { leading: 1.1 }),
        body: text(96, 486, 888, 6, 42, serif(400), palette.muted, { leading: 1.42 }),
      },
    },
    point: {
      ...base,
      shapes: [...frame, rect(96, 430, 72, 5, palette.accent)],
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(96, 236, 888, 2, 70, serif(400, true), palette.ink, { leading: 1.1 }),
        body: text(96, 486, 888, 6, 42, serif(400), palette.ink, { leading: 1.42 }),
      },
    },
    data: {
      ...base,
      shapes: frame,
      number: folio,
      counter: pageCounter,
      slots: {
        title: label(220),
        stat: text(96, 330, 888, 1, 220, serif(400), palette.accent, { leading: 1.05 }),
        body: text(96, 640, 888, 4, 50, serif(400, true), palette.ink, { leading: 1.3 }),
      },
    },
    list: {
      ...base,
      shapes: frame,
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(96, 236, 888, 2, 64, serif(400), palette.ink, { leading: 1.1 }),
        items: text(96, 470, 888, 6, 42, serif(400), palette.ink, { list: listMarker, leading: 1.3 }),
      },
    },
    quote: {
      ...base,
      shapes: frame,
      marks: [mark('“', 84, 150, 340, serif(400), palette.accent)],
      number: folio,
      counter: pageCounter,
      slots: {
        quote: text(96, 470, 888, 5, 62, serif(400, true), palette.ink, { leading: 1.25 }),
        attribution: text(96, 1000, 888, 2, 26, sans(600), palette.accent, { uppercase: true, tracking: 4, leading: 1.4 }),
      },
    },
    closing: {
      ...base,
      shapes: [...frame, rect(96, 1068, 888, 2, palette.ink)],
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(96, 236, 888, 2, 76, serif(400), palette.ink, { leading: 1.1 }),
        body: text(96, 486, 888, 5, 42, serif(400), palette.muted, { leading: 1.42 }),
        cta: text(96, 1100, 888, 1, 28, sans(600), palette.accent, { uppercase: true, tracking: 5, leading: 1.4 }),
      },
    },
  };
  return { templateId, layouts };
}
