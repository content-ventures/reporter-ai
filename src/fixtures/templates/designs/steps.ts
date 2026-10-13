import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, slideNumber, text } from '../kit.ts';

/**
 * Passo a passo (Feed 4:5): a sequence the reader follows. Each inner slide carries its step
 * number large in the accent; lists set their items with numbered markers in a hanging indent;
 * the cover (light, on the page colour) and the closing (dark) share a three-step progress bar —
 * one step on the cover, all three at the end. Features the `list` layout: the generation turns an article list or enumeration into one.
 */
export type StepsPalette = { page: string; ink: string; muted: string; accent: string; deep: string; onDeep: string; soft: string; glow: string; track: string };

export function stepsFeed(templateId: TemplateId, palette: StepsPalette): TemplateRender {
  const page = { background: palette.page, accent: palette.accent, rule: false };
  const deep = { background: palette.deep, accent: palette.glow, rule: false };
  const number = slideNumber(96, 84, 150, sans(600), palette.accent, 'left');
  const pageCounter = counter(984, 1254, 'right', 28, sans(600), palette.muted);
  const deepCounter = counter(984, 1254, 'right', 28, sans(600), palette.soft);
  const progress = (done: number, on = palette.glow, off = palette.track) => [0, 1, 2].map((step) => rect(96 + step * 304, 1150, 280, 12, step < done ? on : off));
  const listMarker = { marker: 'number' as const, indent: 112, color: palette.accent, fontWeight: 600, gap: 40 };
  const inner = (bodyColor: string): LayoutRender => ({
    ...page,
    number,
    counter: pageCounter,
    slots: {
      title: text(96, 330, 888, 2, 66, sans(600), palette.ink, { leading: 1.1 }),
      body: text(96, 530, 888, 6, 46, sans(400), bodyColor, { leading: 1.32 }),
    },
  });
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...page,
      shapes: progress(1, palette.accent, palette.soft),
      counter: pageCounter,
      slots: {
        kicker: text(96, 200, 888, 1, 30, sans(600), palette.accent, { uppercase: true, tracking: 4, leading: 1.4 }),
        title: text(96, 290, 888, 4, 92, sans(600), palette.ink, { leading: 1.06 }),
      },
    },
    context: inner(palette.muted),
    point: inner(palette.ink),
    data: {
      ...page,
      counter: pageCounter,
      slots: {
        title: text(96, 250, 888, 2, 34, sans(600), palette.muted, { uppercase: true, tracking: 3, leading: 1.35 }),
        stat: text(96, 380, 888, 1, 210, sans(600), palette.accent, { leading: 1.05 }),
        body: text(96, 660, 888, 4, 52, sans(500), palette.ink, { leading: 1.22 }),
      },
    },
    list: {
      ...page,
      counter: pageCounter,
      shapes: [rect(96, 200, 64, 8, palette.accent)],
      slots: {
        title: text(96, 250, 888, 2, 64, sans(600), palette.ink, { leading: 1.1 }),
        items: text(96, 480, 888, 6, 50, sans(500), palette.ink, { list: listMarker, leading: 1.2 }),
      },
    },
    quote: {
      ...deep,
      marks: [mark('“', 80, 40, 380, sans(600), palette.glow)],
      counter: deepCounter,
      slots: {
        quote: text(96, 420, 888, 5, 62, sans(500, true), palette.onDeep, { leading: 1.2 }),
        attribution: text(96, 1020, 888, 2, 32, sans(600), palette.glow, { leading: 1.3 }),
      },
    },
    closing: {
      ...deep,
      shapes: progress(3),
      counter: deepCounter,
      slots: {
        title: text(96, 300, 888, 2, 76, sans(600), palette.onDeep, { leading: 1.08 }),
        body: text(96, 510, 888, 5, 44, sans(400), palette.soft, { leading: 1.32 }),
        cta: text(96, 1060, 888, 1, 32, sans(600), palette.glow, { uppercase: true, tracking: 3, leading: 1.4 }),
      },
    },
  };
  return { templateId, layouts };
}
