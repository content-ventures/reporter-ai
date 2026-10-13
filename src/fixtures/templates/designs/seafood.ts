import type { TemplateId } from '../../../domain/index.ts';
import type { LayoutImage, LayoutRender, SampleContent, ShapeStyle, TemplateRender } from '../../../ports/render-template.ts';
import { counter, mark, ramp, rect, sans, serif, text } from '../kit.ts';

/** Editable creative DATA, inspired by Seafood Brasil's photographic, blue B2B language.
 * No rasterised text, invented logo, fixed statistic or invented podcast quotation. All article
 * copy stays in the existing slots; all photographs come from the approved article's cover.
 */
export type SeafoodVariation = 'headline' | 'reportage' | 'flow' | 'panorama' | 'interview' | 'quotes';
const NAVY = '#062B49';
const BLUE = '#075DAF';
const CYAN = '#33C6D9';
const WHITE = '#FFFFFF';
const PAPER = '#F4F8FC';
const MUTED = '#40566A';
const YELLOW = '#F4CF5B';
const M = 84;
const W = 912;
const LINE = '#CFDDE7';
const DARK_LINE = '#385A71';

const angular = (x: number, y: number, width: number, height: number, color: string): ShapeStyle => ({
  ...rect(x, y, width, height, color),
  points: [{ x, y: y + height }, { x: x + height, y }, { x: x + width, y }, { x: x + width - height, y: y + height }],
});

function image(y: number, height: number, options: { inset?: boolean; position?: number } = {}): LayoutImage {
  const x = options.inset ? M : 0;
  const width = options.inset ? W : 1080;
  return {
    background: 'article-cover', x, y, width, height,
    position: { x: 0.5, y: options.position ?? 0.5 },
    scrim: ramp('down', y + Math.max(0, height - 160), y + height - 72, y + height, NAVY, 0.96).map(band => ({ ...band, x, width })),
    credit: { x: options.inset ? M + 24 : M, y: y + height - 48, width: options.inset ? W - 48 : W, fontSize: 24, fontWeight: 400, color: WHITE, align: 'left' },
  };
}

/** Recurring angular signature, typeset label until the client supplies their official logo. */
function page(dark = false, family = 'NOTÍCIA'): LayoutRender {
  const ink = dark ? WHITE : NAVY;
  return {
    background: dark ? NAVY : WHITE, accent: CYAN, rule: false,
    overlays: [rect(M, 1216, W, 2, dark ? DARK_LINE : LINE), angular(900, 1210, 96, 14, CYAN)],
    marks: [{ ...mark(family, M, 88, 28, sans(600), dark ? CYAN : BLUE), tracking: 2 }, { ...mark('SEAFOOD BRASIL', M, 1264, 32, sans(600), ink), tracking: 1 }],
    counter: counter(996, 1264, 'right', 30, sans(400), ink),
    slots: {},
  };
}

function inner(dark: boolean, family: string, photo?: LayoutImage): LayoutRender {
  const base = page(dark, family);
  return {
    ...base,
    ...(photo ? { image: photo } : {}),
    shapes: [rect(M, 176, 60, 4, dark ? CYAN : BLUE)],
    slots: {
      title: text(M, 240, W, 2, 84, sans(600), dark ? WHITE : NAVY, { leading: 1.08, minFontSize: 62, balanced: true }),
      body: text(M, 508, W, 6, 48, sans(400), dark ? WHITE : MUTED, { leading: 1.36 }),
    },
  };
}

function shared(dark: boolean, family: string, podcast: boolean): Record<string, LayoutRender> {
  const ink = dark ? WHITE : NAVY;
  const base = page(dark, family);
  return {
    context: inner(dark, family), point: inner(dark, family),
    data: {
      ...base,
      shapes: [rect(M, 704, W, 2, dark ? DARK_LINE : LINE)],
      slots: {
        title: text(M, 220, W, 2, 76, sans(600), ink, { leading: 1.1, minFontSize: 60, balanced: true }),
        stat: text(M, 420, W, 1, 220, sans(600), dark ? CYAN : BLUE, { leading: 1.05, minFontSize: 140 }),
        body: text(M, 790, W, 4, 50, sans(400), ink, { leading: 1.36 }),
      },
    },
    list: {
      ...base,
      slots: {
        title: text(M, 220, W, 2, 76, sans(600), ink, { leading: 1.1, minFontSize: 60, balanced: true }),
        items: text(M, 460, W, 6, 48, sans(400), ink, {
          leading: 1.32, list: { marker: 'number', indent: 116, gap: 36, color: dark ? CYAN : BLUE, fontWeight: 600 },
        }),
      },
    },
    quote: {
      ...page(false, family),
      shapes: [rect(M, 218, W, 920, podcast ? YELLOW : PAPER)],
      marks: [...(page(false, family).marks ?? []), mark('“', 116, 252, 156, serif(400), NAVY)],
      slots: {
        quote: text(120, 420, 840, 5, 78, sans(500), NAVY, { leading: 1.2, minFontSize: 58, balanced: true, valign: 'middle' }),
        attribution: text(120, 1016, 840, 2, 36, sans(500), NAVY, { leading: 1.3 }),
      },
    },
    closing: {
      ...page(dark, family),
      shapes: [rect(M, 176, 60, 4, dark ? CYAN : BLUE)],
      marks: [...(page(dark, family).marks ?? []), mark('↗', 944, 1062, 60, sans(400), dark ? CYAN : BLUE)],
      slots: {
        title: text(M, 270, W, 2, 84, sans(600), ink, { leading: 1.1, minFontSize: 60, balanced: true }),
        body: text(M, 560, W, 5, 48, sans(400), ink, { leading: 1.36 }),
        cta: text(M, 1074, 804, 1, 36, sans(600), dark ? CYAN : BLUE, { leading: 1.3, minFontSize: 30 }),
      },
    },
  };
}

export function seafoodFeed(templateId: TemplateId, variation: SeafoodVariation): TemplateRender {
  const podcast = variation === 'interview' || variation === 'quotes';
  const explainer = variation === 'flow' || variation === 'panorama';
  const family = podcast ? 'PODCAST' : explainer ? 'EXPLICA' : 'NOTÍCIA';
  const dark = variation === 'panorama' || variation === 'interview';
  const layouts = shared(dark, family, podcast);

  if (variation === 'headline') {
    layouts.cover = {
      ...page(true, family),
      image: { ...image(0, 1350), position: { x: 0.5, y: 0.42 }, scrim: [...ramp('up', 180, 450, 1350, NAVY, 0.82), ...ramp('down', 580, 780, 1350, NAVY, 0.95)], credit: { x: M, y: 1174, width: W, fontSize: 24, fontWeight: 400, color: WHITE, align: 'left' } },
      marks: [{ ...mark(family, 108, 104, 28, sans(600), NAVY), tracking: 2 }, ...(page(true, family).marks ?? []).slice(1)],
      overlays: [rect(0, 1210, 1080, 140, NAVY), ...(page(true, family).overlays ?? []), rect(M, 84, 204, 58, CYAN)],
      slots: {
        kicker: text(M, 188, W, 1, 32, sans(500), WHITE, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 652, W, 4, 114, sans(600), WHITE, { leading: 1.06, minFontSize: 86, balanced: true, valign: 'bottom' }),
      },
    };
    layouts.context = {
      ...page(false, family), image: image(180, 360, { inset: true, position: 0.38 }),
      slots: {
        title: text(M, 592, W, 2, 80, sans(600), NAVY, { leading: 1.08, minFontSize: 60, balanced: true }),
        body: text(M, 822, W, 6, 44, sans(400), MUTED, { leading: 1.3 }),
      },
    };
  } else if (variation === 'reportage') {
    layouts.cover = {
      ...page(false, family), image: image(180, 450, { inset: true, position: 0.34 }),
      slots: {
        kicker: text(M, 678, W, 1, 32, sans(500), BLUE, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 752, W, 4, 98, sans(600), NAVY, { leading: 1.04, minFontSize: 80, balanced: true }),
      },
    };
    layouts.point = {
      ...inner(false, family, image(900, 250, { inset: true, position: 0.45 })),
      slots: {
        title: text(M, 240, W, 2, 84, sans(600), NAVY, { leading: 1.08, minFontSize: 62, balanced: true }),
        body: text(M, 490, W, 6, 44, sans(400), MUTED, { leading: 1.3 }),
      },
    };
    layouts.context = { ...inner(false, family), shapes: [rect(M, 176, W, 2, LINE)] };
  } else if (variation === 'flow') {
    layouts.cover = {
      ...page(false, family), image: image(760, 390, { inset: true, position: 0.43 }),
      shapes: [rect(M, 208, W, 2, LINE)],
      slots: {
        kicker: text(M, 144, W, 1, 32, sans(500), BLUE, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 268, W, 4, 110, sans(600), NAVY, { leading: 1.06, minFontSize: 86, balanced: true }),
      },
    };
    layouts.context = {
      ...inner(false, family, image(920, 230, { inset: true, position: 0.45 })),
      slots: {
        title: text(M, 230, W, 2, 80, sans(600), NAVY, { leading: 1.1, minFontSize: 60, balanced: true }),
        body: text(M, 480, W, 6, 44, sans(400), MUTED, { leading: 1.32 }),
      },
    };
    layouts.list.shapes = [rect(M, 414, W, 2, LINE)];
  } else if (variation === 'panorama') {
    layouts.cover = {
      ...page(true, family), image: image(818, 332, { inset: true, position: 0.5 }),
      shapes: [rect(M, 208, W, 2, DARK_LINE)],
      slots: {
        kicker: text(M, 144, W, 1, 32, sans(500), CYAN, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 270, W, 4, 108, sans(600), WHITE, { leading: 1.06, minFontSize: 86, balanced: true }),
      },
    };
    layouts.point = {
      ...inner(false, family),
      shapes: [rect(M, 176, W, 2, LINE)],
    };
  } else if (variation === 'interview') {
    layouts.cover = {
      ...page(true, family), image: image(180, 450, { inset: true, position: 0.36 }),
      marks: [...(page(true, family).marks ?? []), mark('“', 876, 610, 164, serif(400), CYAN)],
      slots: {
        kicker: text(M, 676, 768, 1, 32, sans(500), CYAN, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 758, W, 4, 104, sans(600), WHITE, { leading: 1.02, minFontSize: 82, balanced: true }),
      },
    };
    layouts.point = { ...inner(false, family), shapes: [rect(M, 176, 60, 4, BLUE)] };
  } else {
    layouts.cover = {
      ...page(false, family), image: image(920, 230, { inset: true, position: 0.45 }),
      marks: [...(page(false, family).marks ?? []), mark('“', M, 218, 204, serif(400), BLUE)],
      slots: {
        kicker: text(M, 144, W, 1, 32, sans(500), BLUE, { uppercase: true, leading: 1.3, tracking: 1, minFontSize: 26 }),
        title: text(M, 408, W, 4, 106, sans(600), NAVY, { leading: 1.06, minFontSize: 84, balanced: true }),
      },
    };
    layouts.context = { ...inner(false, family), shapes: [rect(M, 176, W, 2, LINE)] };
    layouts.point = inner(true, family);
    layouts.quote = {
      ...layouts.quote,
      shapes: [rect(M, 218, W, 920, PAPER), rect(120, 980, 100, 4, YELLOW)],
    };
  }
  return { templateId, layouts };
}

/** Demonstration only; bracketed quotation is NOT attributed to a real podcast participant. */
export const SEAFOOD_SAMPLE_CONTENT: SampleContent = {
  cover: { kicker: 'Indústria do pescado', title: 'Mais eficiência no processamento do pescado' },
  context: { title: 'O que está em discussão', body: 'Pessoas, processos e tecnologia ajudam a organizar a discussão sobre eficiência. Este conteúdo é apenas um exemplo de composição editorial.' },
  point: { title: 'Começar pelo processo', body: 'Mapear etapas e identificar gargalos antes de escolher equipamentos. Texto ilustrativo para visualizar hierarquia e leitura.' },
  data: { title: 'Três frentes para entender o tema', stat: '3', body: 'Pessoas, processos e tecnologia: três tópicos deste exemplo, não uma estatística sobre o mercado.' },
  list: { title: 'Do diagnóstico à decisão', items: 'Mapear o processo\nIdentificar os gargalos\nDefinir prioridades' },
  quote: { quote: '[Citação literal validada do podcast]', attribution: 'Exemplo de campo · não é uma fala real' },
  closing: { title: 'A conversa continua no artigo', body: 'Conheça o contexto, os argumentos e as fontes antes de tomar uma decisão. Exemplo ilustrativo de encerramento.', cta: 'Leia o artigo completo' },
};

export function seafoodSample(variation: SeafoodVariation): SampleContent {
  const titles: Record<SeafoodVariation, string> = {
    headline: 'Mais eficiência no processamento do pescado',
    reportage: 'Por dentro da indústria do pescado',
    flow: 'Onde estão os gargalos do processamento?',
    panorama: 'Pessoas, processos e tecnologia no pescado',
    interview: 'Da conversa à decisão na indústria do pescado',
    quotes: 'O que a conversa revela sobre o setor?',
  };
  return { ...SEAFOOD_SAMPLE_CONTENT, cover: { kicker: 'Indústria do pescado', title: titles[variation] } };
}
