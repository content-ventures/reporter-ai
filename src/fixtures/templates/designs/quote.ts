import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, serif, slideNumber, SQUARE, text } from '../kit.ts';

/**
 * Aspas (Citação, Quadrado 1:1): built around the spoken word. A deep page with a large serif “
 * opens the cover and the quotes; serif italics carry the voice, a warm metallic accent the
 * labels; the inner slides turn to a light page in the same ink so the sequence breathes.
 * `soft`: secondary text on the deep page; `faint`: the folio number on the light page (decoration).
 */
export type QuotePalette = { deep: string; light: string; ink: string; muted: string; accent: string; onDeep: string; soft: string; faint: string };

export function quoteSquare(templateId: TemplateId, palette: QuotePalette): TemplateRender {
  const { margin } = SQUARE;
  const width = 1080 - margin * 2;
  const deep = { background: palette.deep, accent: palette.accent, rule: false };
  const light = { background: palette.light, accent: palette.ink, rule: false };
  const deepCounter = counter(992, 980, 'right', 26, sans(600), palette.accent);
  const lightCounter = counter(992, 980, 'right', 26, sans(600), palette.muted);
  const number = slideNumber(992, 76, 120, serif(400, true), palette.faint, 'right');
  const listMarker = { marker: 'number' as const, indent: 88, color: palette.ink, fontWeight: 600, gap: 18 };
  const inner = (titleItalic: boolean): LayoutRender => ({
    ...light,
    number,
    shapes: [rect(margin, 412, 56, 4, palette.ink)],
    counter: lightCounter,
    slots: {
      title: text(margin, 236, width, 2, 60, serif(400, titleItalic), palette.ink, { leading: 1.12 }),
      body: text(margin, 460, width, 6, 38, sans(400), palette.muted, { leading: 1.36 }),
    },
  });
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...deep,
      marks: [mark('“', 56, 0, 600, serif(400), palette.accent)],
      counter: deepCounter,
      slots: {
        kicker: text(margin, 96, width, 1, 26, sans(600), palette.accent, { uppercase: true, tracking: 5, align: 'right', leading: 1.4 }),
        title: text(margin, 570, width, 4, 78, serif(400), palette.onDeep, { leading: 1.1, valign: 'bottom' }),
      },
    },
    context: inner(false),
    point: inner(true),
    data: {
      ...deep,
      counter: deepCounter,
      slots: {
        title: text(margin, 150, width, 2, 28, sans(600), palette.accent, { uppercase: true, tracking: 4, leading: 1.4 }),
        stat: text(margin, 290, width, 1, 200, serif(400), palette.accent, { leading: 1.05 }),
        body: text(margin, 560, width, 4, 46, serif(400, true), palette.onDeep, { leading: 1.28 }),
      },
    },
    list: {
      ...light,
      number,
      counter: lightCounter,
      slots: {
        title: text(margin, 220, width, 2, 54, serif(400), palette.ink, { leading: 1.12 }),
        items: text(margin, 410, width, 6, 38, sans(400), palette.ink, { list: listMarker, leading: 1.25 }),
      },
    },
    quote: {
      ...deep,
      marks: [mark('“', 56, 0, 480, serif(400), palette.accent)],
      counter: deepCounter,
      slots: {
        quote: text(margin, 300, width, 5, 58, serif(400, true), palette.onDeep, { leading: 1.22, valign: 'middle', room: 6 }),
        attribution: text(margin, 800, width, 2, 28, sans(600), palette.accent, { uppercase: true, tracking: 3, leading: 1.35 }),
      },
    },
    closing: {
      ...deep,
      shapes: [rect(margin, 872, 64, 4, palette.accent)],
      counter: deepCounter,
      slots: {
        title: text(margin, 220, width, 2, 64, serif(400), palette.onDeep, { leading: 1.12 }),
        body: text(margin, 420, width, 5, 38, sans(400), palette.soft, { leading: 1.36 }),
        cta: text(margin, 900, 700, 1, 28, sans(600), palette.accent, { uppercase: true, tracking: 4, leading: 1.4 }),
      },
    },
  };
  return { templateId, layouts };
}
