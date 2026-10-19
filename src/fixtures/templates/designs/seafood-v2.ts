import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutImage, LayoutRender, SampleContent, ShapeStyle, TemplateRender } from '../../../ports/render-template.ts';
import { seafoodLogo, seafoodSymbol } from '../brands/seafood-mark.ts';
import { brand, counter, mark, ramp, rect, rounded, text } from '../kit.ts';

/**
 * Seafood Brasil carousels, second generation: the client's own feed language read from its
 * site and Instagram (October 2026). Montserrat 700/800 headlines, brand navy and sky, the
 * orange of its news posts, the official S mark, rounded photo frames and tags, and an
 * Instagram ending (swipe cue on the cover, "link na bio" call). Same slots as every model,
 * so switching keeps the texts; only the article's own cover photo is ever drawn.
 */
export type SeafoodV2Variation = 'news' | 'photo' | 'explainer' | 'podcast';

/** Brand colours sampled from seafoodbrasil.com.br and @seafoodbrasil. */
const NAVY = '#023E8A';
const DEEP = '#021132';
const SKY = '#2EBAF7';
const ORANGE = '#E68040';
const BEIGE = '#EBE8E1';
const WHITE = '#FFFFFF';
/** Text on white and beige pages. */
const INK = '#0E1A2E';
const SLATE = '#3D4A5C';
/** Text on navy pages. */
const MIST = '#C9D5E8';
/** Line art on the deep navy pages (the brand posts' circles and strokes). */
const TRACE = '#1A2F63';

const M = 88;
const W = 904;
const RIGHT = M + W;
const SWIPE = 'Arraste para o lado  ›';
/**
 * Optical centre of an inner page: the title grows up from it and the text down, so a short
 * and a long page both sit in the middle instead of leaving the bottom half empty.
 */
const SPLIT = 600;

type Tone = 'light' | 'dark';

const ink = (tone: Tone) => (tone === 'light' ? INK : WHITE);
const soft = (tone: Tone) => (tone === 'light' ? SLATE : MIST);

/** The S mark and the "2/7" counter at the top of every inner page. */
function header(tone: Tone): Pick<LayoutRender, 'vectors' | 'counter'> {
  return {
    vectors: [seafoodSymbol(M, 72, 68, tone === 'light' ? 'dark' : 'light')],
    counter: counter(RIGHT, 96, 'right', 28, brand(600), soft(tone)),
  };
}

/**
 * A page of the news model: the white card with its rounded corner over the orange band, the
 * signature of Seafood's news posts. `fill` is the card's colour.
 */
function card(fill: string, band = ORANGE): ShapeStyle[] {
  return [rect(0, 1270, 1080, 80, band), rounded(0, 0, 1080, 1300, fill, [0, 0, 72, 0])];
}

/**
 * The brand posts' line art (open circles and dots) in a tone of the page, on the cover and the
 * closing only, clear of every text box.
 */
function art(color = TRACE): ShapeStyle[] {
  return [
    rounded(760, 56, 264, 264, color, 132, 3),
    rounded(716, 292, 24, 24, color, 12),
    rounded(700, 980, 300, 300, color, 150, 3),
    rounded(660, 1140, 18, 18, color, 9),
  ];
}

/** Inner page base: background, chrome, nothing drawn on the slots yet. */
function page(tone: Tone, background: string, shapes: ShapeStyle[] = []): LayoutRender {
  return { background, accent: tone === 'light' ? NAVY : SKY, rule: false, shapes, ...header(tone), slots: {} };
}

/** Title and text of a statement page (Contexto, Ponto principal), under a short accent rule. */
function statement(base: LayoutRender, tone: Tone): LayoutRender {
  return {
    ...base,
    slots: {
      title: text(M, SPLIT - 44 - 2 * 86, W, 2, 76, brand(700), ink(tone), { leading: 1.13, minFontSize: 58, balanced: true, valign: 'bottom' }),
      body: text(M, SPLIT, W, 6, 48, brand(400), soft(tone), { leading: 1.44, minFontSize: 40 }),
    },
  };
}

/** The figure as the hero of the page. */
function figure(base: LayoutRender, tone: Tone, stat: string, line: string): LayoutRender {
  return {
    ...base,
    shapes: [...(base.shapes ?? []), rect(M, 800, W, 3, line)],
    slots: {
      title: text(M, 236, W, 2, 64, brand(700), ink(tone), { leading: 1.14, minFontSize: 52, balanced: true }),
      stat: text(M, 432, W, 1, 300, brand(800), stat, { leading: 1.08, minFontSize: 180 }),
      body: text(M, 852, W, 4, 44, brand(400), soft(tone), { leading: 1.44, minFontSize: 38 }),
    },
  };
}

/** Numbered steps with large markers. */
function steps(base: LayoutRender, tone: Tone, marker: string): LayoutRender {
  return {
    ...base,
    slots: {
      title: text(M, SPLIT - 104 - 2 * 74, W, 2, 66, brand(700), ink(tone), { leading: 1.12, minFontSize: 52, balanced: true, valign: 'bottom' }),
      items: text(M, SPLIT - 40, W, 6, 46, brand(500), ink(tone), { leading: 1.36, list: { marker: 'number', indent: 116, gap: 40, color: marker, fontWeight: 800 } }),
    },
  };
}

/** The closing page: title, text and the call set as a tag. */
function closing(base: LayoutRender, tone: Tone, cta: string, onCta: string, extra: Partial<LayoutRender> = {}): LayoutRender {
  return {
    ...base,
    ...extra,
    slots: {
      title: text(M, SPLIT - 44 - 2 * 84, W, 2, 76, brand(800), ink(tone), { leading: 1.1, minFontSize: 60, balanced: true, valign: 'bottom' }),
      body: text(M, SPLIT, W, 5, 46, brand(400), soft(tone), { leading: 1.44, minFontSize: 40 }),
      cta: text(M + 30, 1010, W - 60, 1, 32, brand(700), onCta, { leading: 1.2, minFontSize: 26, pill: { color: cta, padX: 30, padY: 18, radius: 40 } }),
    },
  };
}

/** A photo frame (rounded or full bleed) with a dark ramp where its credit sits. */
function photo(box: { x: number; y: number; width: number; height: number }, options: Partial<Pick<LayoutImage, 'radius' | 'scrim' | 'credit'>> & { focus?: number } = {}): LayoutImage {
  const bottom = box.y + box.height;
  return {
    background: 'article-cover',
    ...box,
    position: { x: 0.5, y: options.focus ?? 0.45 },
    ...(options.radius !== undefined ? { radius: options.radius } : {}),
    scrim: options.scrim ?? ramp('down', bottom - 150, bottom - 50, bottom, DEEP, 0.92).map((band) => ({ ...band, x: box.x, width: box.width })),
    credit: options.credit ?? credit(box.x + 32, bottom - 50, box.width - 64, 'left', WHITE),
  };
}

/** The photo's credit line, in the brand face. */
function credit(x: number, y: number, width: number, align: 'left' | 'right', color: string): NonNullable<LayoutImage['credit']> {
  return { x, y, width, fontSize: 22, fontWeight: 500, color, align, fontFamily: brand(500).family };
}

/** The swipe cue of a cover: an outlined tag with the call to swipe, centred. */
function swipe(y: number, color: string): Pick<LayoutRender, 'overlays' | 'marks'> {
  return {
    overlays: [rounded(540 - 200, y, 400, 68, color, 34, 3)],
    marks: [mark(SWIPE, 540, y + 19, 28, brand(600), color, 'center')],
  };
}

function news(): Record<string, LayoutRender> {
  const light = (fill = WHITE) => page('light', fill, card(fill));
  return {
    cover: {
      background: WHITE,
      accent: NAVY,
      rule: false,
      shapes: [...card(WHITE), rounded(616, 0, 464, 420, BEIGE, [0, 0, 0, 88])],
      image: photo({ x: M, y: 184, width: 1080 - M, height: 596 }, { radius: [44, 0, 0, 44], focus: 0.4 }),
      vectors: [seafoodSymbol(M, 56, 92, 'dark')],
      marks: [mark(SWIPE, M, 1294, 28, brand(700), DEEP)],
      counter: counter(RIGHT, 1294, 'right', 28, brand(700), DEEP),
      slots: {
        kicker: text(M, 160, W - 40, 1, 26, brand(700), DEEP, { align: 'right', uppercase: true, tracking: 1.5, leading: 1.2, minFontSize: 22, pill: { color: ORANGE, padX: 28, padY: 16, radius: 40 } }),
        title: text(M, 832, W, 4, 76, brand(700), INK, { leading: 1.12, minFontSize: 60, balanced: true }),
      },
    },
    context: statement(light(), 'light'),
    point: statement(light(), 'light'),
    data: figure(light(), 'light', NAVY, BEIGE),
    list: steps(light(), 'light', NAVY),
    quote: {
      ...page('light', BEIGE, card(BEIGE)),
      marks: [mark('“', M - 6, 168, 300, brand(800), ORANGE)],
      slots: {
        quote: text(M, 860 - 5 * 77, W, 5, 62, brand(700), INK, { leading: 1.24, minFontSize: 48, balanced: true, valign: 'bottom' }),
        attribution: text(M, 900, W, 2, 34, brand(600), NAVY, { leading: 1.32 }),
      },
    },
    closing: closing(page('dark', NAVY, card(NAVY)), 'dark', SKY, DEEP, {
      vectors: [seafoodSymbol(M, 72, 68, 'light'), seafoodLogo(M, 1132, 52, 'light')],
    }),
  };
}

function photoModel(): Record<string, LayoutRender> {
  const full = { x: 0, y: 0, width: 1080, height: 1350 };
  return {
    cover: {
      background: DEEP,
      accent: SKY,
      rule: false,
      image: photo(full, {
        focus: 0.38,
        scrim: [...ramp('up', 100, 330, 1350, DEEP, 0.72), ...ramp('down', 470, 880, 1350, DEEP, 0.95)],
        credit: credit(RIGHT, 1300, 600, 'right', MIST),
      }),
      vectors: [seafoodLogo(M, 78, 50, 'light')],
      ...swipe(1196, WHITE),
      counter: false,
      slots: {
        kicker: text(M + 20, 690, W - 40, 1, 28, brand(800), DEEP, { uppercase: true, tracking: 1.5, leading: 1.2, minFontSize: 22, pill: { color: SKY, padX: 20, padY: 12, radius: 6 } }),
        title: text(M, 770, W, 4, 86, brand(800), WHITE, { leading: 1.06, minFontSize: 66, balanced: true }),
      },
    },
    context: statement(page('dark', DEEP), 'dark'),
    point: statement(page('light', WHITE), 'light'),
    data: figure(page('dark', NAVY), 'dark', WHITE, SKY),
    list: steps(page('light', WHITE), 'light', NAVY),
    quote: {
      ...page('dark', DEEP),
      marks: [mark('“', M - 6, 168, 300, brand(800), SKY)],
      slots: {
        quote: text(M, 860 - 5 * 77, W, 5, 62, brand(700), WHITE, { leading: 1.24, minFontSize: 48, balanced: true, valign: 'bottom' }),
        attribution: text(M, 900, W, 2, 34, brand(600), SKY, { leading: 1.32 }),
      },
    },
    closing: closing(page('dark', DEEP), 'dark', SKY, DEEP, {
      image: photo(full, { focus: 0.4, scrim: [{ ...rect(0, 0, 1080, 1350, DEEP), opacity: 0.84 }], credit: credit(RIGHT, 1300, 600, 'right', MIST) }),
      vectors: [seafoodSymbol(M, 72, 68, 'light'), seafoodLogo(M, 1176, 52, 'light')],
    }),
  };
}

function explainer(): Record<string, LayoutRender> {
  const deep = () => page('dark', DEEP);
  return {
    cover: {
      background: DEEP,
      accent: ORANGE,
      rule: false,
      shapes: [...art(), rect(M, 396, 120, 8, ORANGE)],
      vectors: [seafoodLogo(M, 78, 50, 'light')],
      marks: [mark(SWIPE, M, 1196, 28, brand(600), WHITE)],
      counter: false,
      slots: {
        kicker: text(M, 440, W, 1, 30, brand(700), SKY, { uppercase: true, tracking: 3, leading: 1.2, minFontSize: 24 }),
        title: text(M, 506, W, 4, 92, brand(800), ORANGE, { leading: 1.06, minFontSize: 68, balanced: true }),
      },
    },
    context: statement(deep(), 'dark'),
    point: statement(page('dark', NAVY), 'dark'),
    data: figure(deep(), 'dark', ORANGE, TRACE),
    list: steps(deep(), 'dark', ORANGE),
    quote: {
      ...page('light', ORANGE),
      vectors: [seafoodSymbol(M, 72, 68, 'dark')],
      counter: counter(RIGHT, 96, 'right', 28, brand(600), DEEP),
      marks: [mark('“', M - 6, 168, 300, brand(800), WHITE)],
      slots: {
        quote: text(M, 860 - 5 * 77, W, 5, 62, brand(700), DEEP, { leading: 1.24, minFontSize: 48, balanced: true, valign: 'bottom' }),
        attribution: text(M, 900, W, 2, 34, brand(600), DEEP, { leading: 1.32 }),
      },
    },
    closing: closing(page('dark', DEEP, art()), 'dark', SKY, DEEP, { vectors: [seafoodSymbol(M, 72, 68, 'light'), seafoodLogo(M, 1176, 52, 'light')] }),
  };
}

function podcast(): Record<string, LayoutRender> {
  const full = { x: 0, y: 0, width: 1080, height: 1350 };
  const quoteCard: LayoutRender = {
    ...page('dark', DEEP),
    shapes: [rounded(M, 220, W, 880, WHITE, 44)],
    marks: [mark('“', M + 44, 236, 260, brand(800), ORANGE)],
    slots: {
      quote: text(M + 48, 880 - 5 * 72, W - 96, 5, 58, brand(700), NAVY, { leading: 1.24, minFontSize: 42, balanced: true, valign: 'bottom' }),
      attribution: text(M + 48, 920, W - 96, 2, 32, brand(600), SLATE, { leading: 1.32 }),
    },
  };
  return {
    cover: {
      background: DEEP,
      accent: SKY,
      rule: false,
      image: photo(full, {
        focus: 0.3,
        scrim: [...ramp('up', 100, 330, 1350, DEEP, 0.7), ...ramp('down', 520, 860, 1350, DEEP, 0.95)],
        credit: credit(RIGHT, 1300, 600, 'right', MIST),
      }),
      overlays: [rounded(M, 800, W, 372, WHITE, 40), ...(swipe(1214, WHITE).overlays ?? [])],
      vectors: [seafoodLogo(M, 78, 50, 'light')],
      marks: swipe(1214, WHITE).marks,
      counter: false,
      slots: {
        kicker: text(M + 20, 736, W - 40, 1, 26, brand(800), DEEP, { uppercase: true, tracking: 1.5, leading: 1.2, minFontSize: 22, pill: { color: SKY, padX: 22, padY: 12, radius: 40 } }),
        title: text(M + 48, 840, W - 96, 4, 64, brand(700), NAVY, { leading: 1.14, minFontSize: 50, balanced: true, valign: 'middle', room: 4 }),
      },
    },
    context: statement(page('dark', DEEP), 'dark'),
    point: statement(page('light', WHITE), 'light'),
    data: figure(page('dark', DEEP), 'dark', SKY, TRACE),
    list: steps(page('light', WHITE), 'light', NAVY),
    quote: quoteCard,
    closing: closing(page('dark', DEEP), 'dark', SKY, DEEP, { vectors: [seafoodSymbol(M, 72, 68, 'light'), seafoodLogo(M, 1176, 52, 'light')] }),
  };
}

const BUILDERS: Readonly<Record<SeafoodV2Variation, () => Record<string, LayoutRender>>> = { news, photo: photoModel, explainer, podcast };

export function seafoodV2Feed(templateId: TemplateId, variation: SeafoodV2Variation): TemplateRender {
  return { templateId, layouts: BUILDERS[variation]() };
}

/** Demonstration copy only: no real statistic and no quotation attributed to a real person. */
const SAMPLE: SampleContent = {
  cover: { kicker: 'Indústria', title: 'Mais eficiência no processamento do pescado' },
  context: { title: 'O que está em jogo', body: 'Pessoas, processos e tecnologia organizam a discussão sobre eficiência. Texto de exemplo para ver hierarquia e leitura.' },
  point: { title: 'Começar pelo processo', body: 'Mapear etapas e achar gargalos antes de escolher equipamentos. Texto ilustrativo para visualizar a composição.' },
  data: { title: 'Três frentes para entender o tema', stat: '3', body: 'Pessoas, processos e tecnologia: três tópicos deste exemplo, não uma estatística do mercado.' },
  list: { title: 'Do diagnóstico à decisão', items: 'Mapear o processo\nIdentificar os gargalos\nDefinir prioridades' },
  quote: { quote: '[Citação literal validada do artigo]', attribution: 'Exemplo de campo · não é uma fala real' },
  closing: { title: 'A conversa continua', body: 'Contexto, argumentos e fontes estão na matéria completa. Exemplo ilustrativo de encerramento.', cta: 'Matéria completa no link da bio' },
};

export function seafoodV2Sample(variation: SeafoodV2Variation): SampleContent {
  if (variation === 'explainer') return { ...SAMPLE, cover: { kicker: 'Explica', title: 'Onde estão os gargalos do processamento?' } };
  if (variation === 'podcast') {
    return {
      ...SAMPLE,
      cover: { kicker: 'Podcast · Ep. 03', title: 'Da conversa à decisão na indústria do pescado' },
      quote: { quote: '[Citação literal validada do podcast]', attribution: 'Exemplo de campo · não é uma fala real' },
      closing: { ...SAMPLE.closing, cta: 'Episódio completo no link da bio' },
    };
  }
  if (variation === 'photo') return { ...SAMPLE, cover: { kicker: 'Reportagem', title: 'Por dentro da indústria do pescado' } };
  return SAMPLE;
}
