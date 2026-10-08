import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutImage, LayoutRender, ScrimStyle, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, ramp, rect, sans, slideNumber, text } from '../kit.ts';

/**
 * Fotografia (Foto em destaque, Feed 4:5): the article's featured image full bleed on the cover,
 * the quote and the closing, darkened by overlapping flat bands (`ramp`) so white type stays
 * legible on any photo; the inner slides are a dark page with a warm accent. Without the image the same
 * layouts read as a dark typographic page.
 */
export type PhotoPalette = { dark: string; light: string; soft: string; accent: string; scrim: string };

const scrim = (y: number, height: number, color: string, opacity: number): ScrimStyle => ({ ...rect(0, y, 1080, height, color), opacity });

function fullBleed(palette: PhotoPalette, scrims: ScrimStyle[], extra: Partial<LayoutImage> = {}): LayoutImage {
  return { background: 'article-cover', x: 0, y: 0, width: 1080, height: 1350, scrim: scrims, ...extra };
}

export function photoFeed(templateId: TemplateId, palette: PhotoPalette): TemplateRender {
  const base = { background: palette.dark, accent: palette.accent, rule: false };
  const number = slideNumber(96, 92, 110, sans(600), palette.accent, 'left');
  const pageCounter = counter(984, 1254, 'right', 28, sans(600), palette.light);
  const listMarker = { marker: 'number' as const, indent: 104, color: palette.accent, fontWeight: 600, gap: 28 };
  const inner = (title: string, body: string): LayoutRender => ({
    ...base,
    number,
    counter: pageCounter,
    slots: {
      title: text(96, 320, 888, 2, 68, sans(600), title, { leading: 1.1 }),
      body: text(96, 520, 888, 6, 44, sans(400), body, { leading: 1.36 }),
    },
  });
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...base,
      // The photo full bleed: a ramp at the top for the call, a deeper one at the bottom for the title.
      image: fullBleed(palette, [...ramp('up', 120, 380, 1350, palette.scrim, 0.6), ...ramp('down', 500, 1000, 1350, palette.scrim, 0.74)], {
        slotColors: { kicker: palette.light },
        credit: { x: 96, y: 1258, width: 640, fontSize: 22, fontWeight: 500, color: palette.soft, align: 'left' },
      }),
      overlays: [rect(96, 160, 64, 6, palette.accent)],
      counter: pageCounter,
      slots: {
        kicker: text(96, 100, 888, 1, 28, sans(600), palette.accent, { uppercase: true, tracking: 4, leading: 1.4 }),
        title: text(96, 760, 888, 4, 92, sans(600), palette.light, { leading: 1.08, valign: 'bottom' }),
      },
    },
    context: inner(palette.light, palette.soft),
    point: inner(palette.accent, palette.light),
    data: {
      ...base,
      counter: pageCounter,
      shapes: [rect(96, 160, 64, 6, palette.accent)],
      slots: {
        title: text(96, 220, 888, 2, 32, sans(600), palette.soft, { uppercase: true, tracking: 4, leading: 1.35 }),
        stat: text(96, 340, 888, 1, 210, sans(600), palette.accent, { leading: 1.05 }),
        body: text(96, 620, 888, 4, 52, sans(500), palette.light, { leading: 1.25 }),
      },
    },
    list: {
      ...base,
      number,
      counter: pageCounter,
      slots: {
        title: text(96, 300, 888, 2, 64, sans(600), palette.light, { leading: 1.1 }),
        items: text(96, 530, 888, 6, 44, sans(400), palette.light, { list: listMarker, leading: 1.25 }),
      },
    },
    quote: {
      ...base,
      image: fullBleed(palette, [scrim(0, 1350, palette.scrim, 0.78)], { counterColor: palette.light }),
      marks: [mark('“', 80, 120, 360, sans(600), palette.accent)],
      counter: pageCounter,
      slots: {
        quote: text(96, 480, 888, 5, 60, sans(500, true), palette.light, { leading: 1.22 }),
        attribution: text(96, 1000, 888, 2, 32, sans(600), palette.accent, { leading: 1.3 }),
      },
    },
    closing: {
      ...base,
      image: fullBleed(palette, [scrim(0, 1350, palette.scrim, 0.78)]),
      overlays: [rect(96, 1110, 120, 6, palette.accent)],
      number,
      counter: pageCounter,
      slots: {
        title: text(96, 320, 888, 2, 76, sans(600), palette.light, { leading: 1.08 }),
        body: text(96, 530, 888, 5, 44, sans(400), palette.soft, { leading: 1.36 }),
        cta: text(96, 1140, 700, 1, 32, sans(600), palette.accent, { uppercase: true, tracking: 3, leading: 1.4 }),
      },
    },
  };
  return { templateId, layouts };
}
