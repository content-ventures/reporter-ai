import type { CarouselTemplate, SlideLayout, TemplateId } from '../../domain/index.ts';

/**
 * Provisional carousel templates (PLAN §3.7): creative DATA, not interface. Marketing's three
 * approved models (Q4) join them in `catalog.ts`; until they arrive these two neutral templates
 * keep the studio, the RenderService and the export working, and Pedro accepts them for R1 · Experiência
 * (D09). Their names say what they look like — never "Provisório": the approver and the delivery
 * read the template name (D09 plan B); the `provisional` flag stays in the data.
 * Colours exist only here, as creative content. Canvas: 1080×1350 (4:5). Geometry in canvas pixels.
 */

export const NEUTRAL_LIGHT_TEMPLATE_ID: TemplateId = 'tpl-provisorio-claro';
export const NEUTRAL_DARK_TEMPLATE_ID: TemplateId = 'tpl-provisorio-escuro';
export const DEFAULT_TEMPLATE_ID: TemplateId = NEUTRAL_LIGHT_TEMPLATE_ID;

const LAYOUTS: SlideLayout[] = [
  {
    id: 'cover',
    label: 'Capa',
    articleCover: true,
    slots: [
      { id: 'kicker', label: 'Chamada', role: 'kicker', maxChars: 32, maxLines: 1 },
      { id: 'title', label: 'Título', role: 'title', maxChars: 70, maxLines: 3, required: true },
    ],
  },
  {
    id: 'context',
    label: 'Contexto',
    slots: [
      { id: 'title', label: 'Título', role: 'title', maxChars: 40, maxLines: 2 },
      { id: 'body', label: 'Texto', role: 'body', maxChars: 200, maxLines: 6, required: true },
    ],
  },
  {
    id: 'point',
    label: 'Ponto principal',
    slots: [
      { id: 'title', label: 'Título', role: 'title', maxChars: 40, maxLines: 2, required: true },
      { id: 'body', label: 'Texto', role: 'body', maxChars: 200, maxLines: 6 },
    ],
  },
  {
    id: 'quote',
    label: 'Citação',
    slots: [
      { id: 'quote', label: 'Citação', role: 'quote', maxChars: 140, maxLines: 5, required: true },
      { id: 'attribution', label: 'Crédito', role: 'attribution', maxChars: 60, maxLines: 2 },
    ],
  },
  {
    id: 'closing',
    label: 'Conclusão',
    slots: [
      { id: 'title', label: 'Título', role: 'title', maxChars: 50, maxLines: 2, required: true },
      { id: 'body', label: 'Texto', role: 'body', maxChars: 160, maxLines: 5 },
      { id: 'cta', label: 'Chamada final', role: 'cta', maxChars: 32, maxLines: 1 },
    ],
  },
];

function template(id: TemplateId, name: string): CarouselTemplate {
  return { id, name, width: 1080, height: 1350, minSlides: 3, maxSlides: 10, coverLayoutId: 'cover', layouts: LAYOUTS };
}

/** pt-BR one-liners for the template ChoiceCard (RenderService `TemplateInfo.description`). */
export const TEMPLATE_DESCRIPTIONS: Readonly<Record<TemplateId, string>> = {
  [NEUTRAL_LIGHT_TEMPLATE_ID]: 'Fundo claro, faixa terracota e títulos fortes.',
  [NEUTRAL_DARK_TEMPLATE_ID]: 'Fundo escuro com destaque ciano.',
};

export const PROVISIONAL_TEMPLATES: readonly CarouselTemplate[] = [
  template(NEUTRAL_LIGHT_TEMPLATE_ID, 'Claro'),
  template(NEUTRAL_DARK_TEMPLATE_ID, 'Escuro'),
];

/** Text style of one slot box, as the local renderer draws it. */
export type SlotStyle = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  align: 'left' | 'center';
  italic?: boolean;
};

type ShapeStyle = { x: number; y: number; width: number; height: number; color: string };
type MarkStyle = { text: string; x: number; y: number; fontSize: number; fontWeight: number; color: string; fontFamily?: string };
type NumberStyle = { x: number; y: number; fontSize: number; fontWeight: number; color: string; align?: 'left' | 'right' };
type ScrimStyle = ShapeStyle & { opacity: number };

/** The credit line of the photo ("Foto: Ana Prado"), one line, set over the scrim. */
type CreditStyle = { x: number; y: number; width: number; fontSize: number; fontWeight: number; color: string; align: 'left' | 'right' };

/** The article cover drawn under the text (cover-fit), with a flat legibility scrim on top and its credit. */
type LayoutImage = {
  background: 'article-cover';
  x: number;
  y: number;
  width: number;
  height: number;
  scrim: ScrimStyle[];
  slotColors?: Record<string, string>;
  counterColor?: string;
  credit?: CreditStyle;
};

export type LayoutRender = {
  background: string;
  accent: string;
  slots: Record<string, SlotStyle>;
  image?: LayoutImage;
  shapes?: ShapeStyle[];
  marks?: MarkStyle[];
  number?: NumberStyle;
  rule?: boolean;
  counterColor?: string;
};

export type TemplateRender = {
  templateId: TemplateId;
  /** Placeholder until Marketing's templates arrive (D07); data only, never shown as a word (D09). */
  provisional: boolean;
  layouts: Record<string, LayoutRender>;
};

/**
 * `onAccent`: text set on an accent block; `faint`: the large slide number (flat, no transparency);
 * `scrim`/`onImage`: the band that keeps the call legible over the article cover, and its text.
 */
type Palette = { background: string; ink: string; muted: string; accent: string; onAccent: string; faint: string; scrim: string; onImage: string };

const FONT = 'Inter';

function box(x: number, y: number, width: number, height: number, fontSize: number, fontWeight: number, color: string, extra: Partial<SlotStyle> = {}): SlotStyle {
  return { x, y, width, height, fontFamily: FONT, fontWeight, fontSize, lineHeight: Math.round(fontSize * 1.2), color, align: 'left', ...extra };
}

/**
 * Hierarchy of the provisional creatives, flat (no gradient): the cover opens on a bled accent
 * block with the call on it, inner slides carry their number set large, the quote slide opens on
 * a large “ and the closing ends on an accent band with the call to action.
 */
function renderFor(templateId: TemplateId, palette: Palette): TemplateRender {
  const base = { background: palette.background, accent: palette.accent };
  const number = { x: 984, y: 120, fontSize: 168, fontWeight: 700, color: palette.faint };
  return {
    templateId,
    provisional: true,
    layouts: {
      cover: {
        ...base,
        rule: false,
        shapes: [{ x: 0, y: 0, width: 1080, height: 600, color: palette.accent }],
        // With an article cover, the photo takes the accent block; a dark band under the call keeps
        // it legible and a thin accent edge keeps the template's colour.
        image: {
          background: 'article-cover',
          x: 0,
          y: 0,
          width: 1080,
          height: 600,
          scrim: [
            { x: 0, y: 400, width: 1080, height: 200, color: palette.scrim, opacity: 0.72 },
            { x: 0, y: 588, width: 1080, height: 12, color: palette.accent, opacity: 1 },
          ],
          slotColors: { kicker: palette.onImage },
          // The photo leaves with its credit (R2 REQ-2.9), small, on the band under the call.
          credit: { x: 984, y: 540, width: 560, fontSize: 22, fontWeight: 500, color: palette.onImage, align: 'right' },
        },
        counterColor: palette.muted,
        slots: {
          kicker: box(96, 456, 888, 60, 36, 700, palette.onAccent),
          title: box(96, 700, 888, 460, 92, 700, palette.ink),
        },
      },
      context: {
        ...base,
        number,
        slots: {
          title: box(96, 300, 888, 160, 64, 700, palette.ink),
          body: box(96, 520, 888, 600, 46, 400, palette.muted),
        },
      },
      point: {
        ...base,
        number,
        slots: {
          title: box(96, 300, 888, 160, 64, 700, palette.accent),
          body: box(96, 520, 888, 600, 46, 400, palette.ink),
        },
      },
      quote: {
        ...base,
        rule: false,
        marks: [{ text: '“', x: 80, y: 40, fontSize: 380, fontWeight: 700, color: palette.accent }],
        slots: {
          quote: box(96, 400, 888, 560, 62, 500, palette.ink, { italic: true }),
          attribution: box(96, 1040, 888, 120, 34, 600, palette.accent),
        },
      },
      closing: {
        ...base,
        number,
        shapes: [{ x: 0, y: 1080, width: 1080, height: 270, color: palette.accent }],
        counterColor: palette.onAccent,
        slots: {
          title: box(96, 300, 888, 180, 72, 700, palette.ink),
          body: box(96, 540, 888, 400, 44, 400, palette.muted),
          cta: box(96, 1150, 888, 70, 40, 700, palette.onAccent),
        },
      },
    },
  };
}

export const TEMPLATE_RENDERS: Readonly<Record<TemplateId, TemplateRender>> = {
  [NEUTRAL_LIGHT_TEMPLATE_ID]: renderFor(NEUTRAL_LIGHT_TEMPLATE_ID, {
    background: '#F7F5F2',
    ink: '#1C1C1A',
    muted: '#4A4A46',
    accent: '#B5472B',
    onAccent: '#FFFFFF',
    faint: '#E6DED6',
    scrim: '#1C1C1A',
    onImage: '#FFFFFF',
  }),
  [NEUTRAL_DARK_TEMPLATE_ID]: renderFor(NEUTRAL_DARK_TEMPLATE_ID, {
    background: '#14141F',
    ink: '#F4F4F8',
    muted: '#C4C4D0',
    accent: '#5CC8E0',
    onAccent: '#14141F',
    faint: '#262636',
    scrim: '#14141F',
    onImage: '#F4F4F8',
  }),
};
