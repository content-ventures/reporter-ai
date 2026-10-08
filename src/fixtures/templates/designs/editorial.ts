import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutRender, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, rect, sans, slideNumber, SQUARE, text } from '../kit.ts';

/**
 * Editorial family: the composition the product shipped with (accepted for R1 · Experiência,
 * D09), flat and typographic. The cover opens on a bled accent block — or the article's featured
 * image over it — with the call on it; inner slides carry their number set large; the quote
 * opens on a large “; the closing ends on an accent band with the call to action.
 *
 * `onAccent`: text set on an accent block; `faint`: the large slide number (flat, no
 * transparency); `scrim`/`onImage`: the band that keeps the call legible over the photo.
 */
export type EditorialPalette = {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  faint: string;
  scrim: string;
  onImage: string;
};

/** Feed 4:5 (1080 × 1350): Editorial and Noturno. Geometry kept from the first models, so their copy still fits. */
export function editorialFeed(templateId: TemplateId, palette: EditorialPalette): TemplateRender {
  const base = { background: palette.background, accent: palette.accent };
  const number = slideNumber(984, 120, 168, sans(600), palette.faint);
  const listMarker = { marker: 'number' as const, indent: 104, color: palette.accent, fontWeight: 600, gap: 28 };
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...base,
      rule: false,
      shapes: [rect(0, 0, 1080, 600, palette.accent)],
      // With the featured image, the photo takes the accent block; a dark band under the call keeps
      // it legible and a thin accent edge keeps the model's colour.
      image: {
        background: 'article-cover',
        x: 0,
        y: 0,
        width: 1080,
        height: 600,
        scrim: [
          { ...rect(0, 400, 1080, 200, palette.scrim), opacity: 0.72 },
          { ...rect(0, 588, 1080, 12, palette.accent), opacity: 1 },
        ],
        slotColors: { kicker: palette.onImage },
        // The photo leaves with its credit (R2 REQ-2.9), small, on the band under the call.
        credit: { x: 984, y: 540, width: 560, fontSize: 22, fontWeight: 500, color: palette.onImage, align: 'right' },
      },
      counterColor: palette.muted,
      slots: {
        kicker: text(96, 456, 888, 1, 36, sans(600), palette.onAccent, { leading: 1.5 }),
        title: text(96, 700, 888, 3, 92, sans(600), palette.ink, { room: 4 }),
      },
    },
    context: {
      ...base,
      number,
      slots: {
        title: text(96, 300, 888, 2, 64, sans(600), palette.ink),
        body: text(96, 520, 888, 6, 46, sans(400), palette.muted, { room: 10 }),
      },
    },
    point: {
      ...base,
      number,
      slots: {
        title: text(96, 300, 888, 2, 64, sans(600), palette.accent),
        body: text(96, 520, 888, 6, 46, sans(400), palette.ink, { room: 10 }),
      },
    },
    data: {
      ...base,
      slots: {
        title: text(96, 300, 888, 2, 36, sans(600), palette.muted, { uppercase: true, tracking: 3, leading: 1.3 }),
        stat: text(96, 420, 888, 1, 200, sans(600), palette.accent, { leading: 1.1 }),
        body: text(96, 700, 888, 4, 52, sans(400), palette.ink, { leading: 1.25 }),
      },
    },
    list: {
      ...base,
      number,
      slots: {
        title: text(96, 300, 888, 2, 60, sans(600), palette.ink),
        items: text(96, 520, 888, 6, 44, sans(400), palette.ink, { list: listMarker }),
      },
    },
    quote: {
      ...base,
      rule: false,
      marks: [mark('“', 80, 40, 380, sans(600), palette.accent)],
      slots: {
        quote: text(96, 400, 888, 5, 62, sans(500, true), palette.ink, { room: 7 }),
        attribution: text(96, 1040, 888, 2, 34, sans(600), palette.accent),
      },
    },
    closing: {
      ...base,
      number,
      shapes: [rect(0, 1080, 1080, 270, palette.accent)],
      counterColor: palette.onAccent,
      slots: {
        title: text(96, 300, 888, 2, 72, sans(600), palette.ink, { leading: 1.25 }),
        body: text(96, 540, 888, 5, 44, sans(400), palette.muted, { room: 7 }),
        cta: text(96, 1150, 888, 1, 40, sans(600), palette.onAccent, { leading: 1.5 }),
      },
    },
  };
  return { templateId, layouts };
}

/**
 * Square 1:1 (1080 × 1080): Pauta. Same grammar on a smaller canvas — the photo band on the
 * cover, the large number inside, the accent band at the end — with a short accent dash
 * instead of the top rule.
 */
export function editorialSquare(templateId: TemplateId, palette: EditorialPalette): TemplateRender {
  const { margin } = SQUARE;
  const width = 1080 - margin * 2;
  const base = { background: palette.background, accent: palette.accent, rule: false };
  const dash = rect(margin, 72, 80, 8, palette.accent);
  const number = slideNumber(992, 92, 140, sans(600), palette.faint);
  const pageCounter = counter(992, 980, 'right', 26, sans(600), palette.muted);
  const listMarker = { marker: 'number' as const, indent: 92, color: palette.accent, fontWeight: 600, gap: 18 };
  const layouts: Record<string, LayoutRender> = {
    cover: {
      ...base,
      shapes: [rect(0, 0, 1080, 470, palette.accent)],
      image: {
        background: 'article-cover',
        x: 0,
        y: 0,
        width: 1080,
        height: 470,
        scrim: [{ ...rect(0, 320, 1080, 150, palette.scrim), opacity: 0.72 }],
        slotColors: { kicker: palette.onImage },
        credit: { x: 992, y: 434, width: 420, fontSize: 20, fontWeight: 500, color: palette.onImage, align: 'right' },
      },
      counter: pageCounter,
      slots: {
        kicker: text(margin, 356, width, 1, 30, sans(600), palette.onAccent, { uppercase: true, tracking: 3 }),
        title: text(margin, 530, width, 4, 76, sans(600), palette.ink, { leading: 1.1 }),
      },
    },
    context: {
      ...base,
      shapes: [dash],
      number,
      counter: pageCounter,
      slots: {
        title: text(margin, 250, width, 2, 56, sans(600), palette.ink),
        body: text(margin, 430, width, 6, 38, sans(400), palette.muted, { leading: 1.3 }),
      },
    },
    point: {
      ...base,
      shapes: [dash],
      number,
      counter: pageCounter,
      slots: {
        title: text(margin, 250, width, 2, 56, sans(600), palette.accent),
        body: text(margin, 430, width, 6, 38, sans(400), palette.ink, { leading: 1.3 }),
      },
    },
    data: {
      ...base,
      shapes: [dash],
      counter: pageCounter,
      slots: {
        title: text(margin, 230, width, 2, 30, sans(600), palette.muted, { uppercase: true, tracking: 3, leading: 1.3 }),
        stat: text(margin, 330, width, 1, 190, sans(600), palette.accent, { leading: 1.1 }),
        body: text(margin, 590, width, 4, 44, sans(400), palette.ink, { leading: 1.25 }),
      },
    },
    list: {
      ...base,
      shapes: [dash],
      number,
      counter: pageCounter,
      slots: {
        title: text(margin, 230, width, 2, 52, sans(600), palette.ink),
        items: text(margin, 420, width, 6, 38, sans(400), palette.ink, { list: listMarker }),
      },
    },
    quote: {
      ...base,
      marks: [mark('“', 72, 24, 320, sans(600), palette.accent)],
      counter: pageCounter,
      slots: {
        quote: text(margin, 320, width, 5, 52, sans(500, true), palette.ink),
        attribution: text(margin, 690, width, 2, 30, sans(600), palette.accent),
      },
    },
    closing: {
      ...base,
      shapes: [dash, rect(0, 860, 1080, 220, palette.accent)],
      number,
      counter: counter(992, 948, 'right', 26, sans(600), palette.onAccent),
      slots: {
        title: text(margin, 220, width, 2, 60, sans(600), palette.ink),
        body: text(margin, 420, width, 5, 38, sans(400), palette.muted, { leading: 1.3 }),
        cta: text(margin, 940, 700, 1, 34, sans(600), palette.onAccent),
      },
    },
  };
  return { templateId, layouts };
}
