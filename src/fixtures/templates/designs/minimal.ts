import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, rect, sans, slideNumber, SQUARE, text } from '../kit.ts';

/**
 * Minimal (Quadrado 1:1): white space does the work. One ink, one grey, medium weights, a single
 * hairline that holds the page and a small folio; nothing is decoration but the type itself.
 */
export type MinimalPalette = { page: string; ink: string; muted: string; hairline: string };

export function minimalSquare(templateId: TemplateId, palette: MinimalPalette): TemplateRender {
  const { margin } = SQUARE;
  const width = 1080 - margin * 2;
  const base = { background: palette.page, accent: palette.ink, rule: false };
  const hairline = rect(margin, 940, width, 2, palette.hairline);
  const folio = slideNumber(margin, 88, 26, sans(500), palette.muted, 'left');
  const pageCounter = counter(992, 968, 'right', 24, sans(500), palette.muted, 2);
  const label = (y: number) => text(margin, y, width, 2, 24, sans(500), palette.muted, { uppercase: true, tracking: 5, leading: 1.5 });
  const listMarker = { marker: 'number' as const, indent: 80, color: palette.muted, fontWeight: 500, gap: 20 };
  const inner = (bodyColor: string): LayoutRender => ({
    ...base,
    shapes: [hairline],
    number: folio,
    counter: pageCounter,
    slots: {
      title: text(margin, 280, width, 2, 54, sans(500), palette.ink, { leading: 1.15 }),
      body: text(margin, 450, width, 6, 36, sans(400), bodyColor, { leading: 1.45 }),
    },
  });
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...base,
      shapes: [hairline],
      counter: pageCounter,
      slots: {
        kicker: text(margin, 88, width, 1, 24, sans(500), palette.muted, { uppercase: true, tracking: 6, leading: 1.5 }),
        title: text(margin, 240, width, 4, 70, sans(500), palette.ink, { leading: 1.14, valign: 'middle', room: 7 }),
      },
    },
    context: inner(palette.muted),
    point: inner(palette.ink),
    data: {
      ...base,
      shapes: [hairline],
      number: folio,
      counter: pageCounter,
      slots: {
        title: label(220),
        stat: text(margin, 320, width, 1, 190, sans(500), palette.ink, { leading: 1.05 }),
        body: text(margin, 580, width, 4, 40, sans(400), palette.muted, { leading: 1.4 }),
      },
    },
    list: {
      ...base,
      shapes: [hairline],
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(margin, 240, width, 2, 50, sans(500), palette.ink, { leading: 1.15 }),
        items: text(margin, 420, width, 6, 36, sans(400), palette.ink, { list: listMarker, leading: 1.3 }),
      },
    },
    quote: {
      ...base,
      shapes: [hairline],
      number: folio,
      counter: pageCounter,
      slots: {
        quote: text(margin, 230, width, 5, 54, sans(400, true), palette.ink, { leading: 1.25, valign: 'middle', room: 7 }),
        attribution: text(margin, 820, width, 2, 26, sans(500), palette.muted, { leading: 1.4 }),
      },
    },
    closing: {
      ...base,
      shapes: [hairline],
      number: folio,
      counter: pageCounter,
      slots: {
        title: text(margin, 280, width, 2, 58, sans(500), palette.ink, { leading: 1.15 }),
        body: text(margin, 450, width, 5, 36, sans(400), palette.muted, { leading: 1.45 }),
        cta: text(margin, 860, 700, 1, 24, sans(500), palette.ink, { uppercase: true, tracking: 5, leading: 1.5 }),
      },
    },
  };
  return { templateId, layouts };
}
