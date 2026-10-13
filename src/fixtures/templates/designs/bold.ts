import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, slideNumber, text } from '../kit.ts';

/**
 * Manchete (Contraste, Feed 4:5): poster type on a signal colour. The cover is a field of the
 * signal colour with the headline set tight at the bottom and an arrow that asks for the swipe;
 * inner slides alternate black and the signal colour; the closing ends on a band with the call.
 */
export type BoldPalette = { dark: string; light: string; soft: string; signal: string };

export function boldFeed(templateId: TemplateId, palette: BoldPalette): TemplateRender {
  const onDark = { background: palette.dark, accent: palette.signal, rule: false };
  const onSignal = { background: palette.signal, accent: palette.dark, rule: false };
  const number = slideNumber(96, 92, 120, sans(600), palette.signal, 'left');
  const darkCounter = counter(984, 1254, 'right', 28, sans(600), palette.signal);
  const signalCounter = counter(984, 1254, 'right', 28, sans(600), palette.dark);
  const listMarker = { marker: 'number' as const, indent: 112, color: palette.signal, fontWeight: 600, gap: 30 };
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...onSignal,
      shapes: [rect(96, 150, 888, 6, palette.dark)],
      marks: [mark('→', 984, 196, 150, sans(500), palette.dark, 'right')],
      counter: signalCounter,
      slots: {
        kicker: text(96, 92, 888, 1, 30, sans(600), palette.dark, { uppercase: true, tracking: 4 }),
        title: text(96, 680, 888, 4, 104, sans(600), palette.dark, { leading: 1.02, valign: 'bottom' }),
      },
    },
    context: {
      ...onDark,
      number,
      counter: darkCounter,
      slots: {
        title: text(96, 330, 888, 2, 76, sans(600), palette.light, { leading: 1.05 }),
        body: text(96, 540, 888, 6, 46, sans(400), palette.soft, { leading: 1.3 }),
      },
    },
    point: {
      ...onDark,
      number,
      counter: darkCounter,
      slots: {
        title: text(96, 330, 888, 2, 76, sans(600), palette.signal, { leading: 1.05 }),
        body: text(96, 540, 888, 6, 46, sans(400), palette.light, { leading: 1.3 }),
      },
    },
    data: {
      ...onSignal,
      shapes: [rect(96, 150, 888, 6, palette.dark)],
      counter: signalCounter,
      slots: {
        title: text(96, 204, 888, 2, 30, sans(600), palette.dark, { uppercase: true, tracking: 4, leading: 1.3 }),
        stat: text(96, 360, 888, 1, 210, sans(600), palette.dark, { leading: 1.05 }),
        body: text(96, 640, 888, 4, 56, sans(600), palette.dark, { leading: 1.15 }),
      },
    },
    list: {
      ...onDark,
      number,
      counter: darkCounter,
      slots: {
        title: text(96, 300, 888, 2, 68, sans(600), palette.light, { leading: 1.05 }),
        items: text(96, 540, 888, 6, 46, sans(500), palette.light, { list: listMarker, leading: 1.2 }),
      },
    },
    quote: {
      ...onSignal,
      marks: [mark('“', 72, 20, 420, sans(600), palette.dark)],
      counter: signalCounter,
      slots: {
        quote: text(96, 420, 888, 5, 66, sans(600), palette.dark, { leading: 1.12 }),
        attribution: text(96, 1060, 888, 2, 30, sans(600), palette.dark, { uppercase: true, tracking: 3, leading: 1.3 }),
      },
    },
    closing: {
      ...onDark,
      number,
      shapes: [rect(0, 1110, 1080, 240, palette.signal)],
      counter: signalCounter,
      slots: {
        title: text(96, 330, 888, 2, 80, sans(600), palette.signal, { leading: 1.05 }),
        body: text(96, 540, 888, 5, 46, sans(400), palette.soft, { leading: 1.3 }),
        cta: text(96, 1180, 700, 1, 34, sans(600), palette.dark, { uppercase: true, tracking: 3 }),
      },
    },
  };
  return { templateId, layouts };
}
