import { EDITORIAL_FORMATS, FORMAT_SPECS, formatSizeOf } from '../../../domain/formats.ts';
import type { EditorialFormat } from '../../../domain/formats.ts';
import type { BriefInput } from '../../../ports/production-commands.ts';

export type NewsContentType = 'article' | 'carousel' | EditorialFormat;
export type NewsContentSettings = { format?: NewsContentType; formatSize?: string };
export const NEWS_CONTENT_TYPES = [
  { value: 'article' as const, title: 'Hard news', description: 'Artigo com título, abertura e desenvolvimento.' },
  ...EDITORIAL_FORMATS.map(value => ({ value, title: FORMAT_SPECS[value].label, description: FORMAT_SPECS[value].summary })),
  { value: 'carousel' as const, title: 'Carrossel', description: 'Gera primeiro o artigo. O carrossel segue após a aprovação do texto.' },
];

export function newsContentBrief(settings: NewsContentSettings, angle: string, count: number): BriefInput {
  const format = settings.format === 'article' || settings.format === 'carousel' ? undefined : settings.format;
  const selectedSize = format ? formatSizeOf(format, settings.formatSize) : undefined;
  const request = count === 1 ? 'Notícia a partir da fonte selecionada.' : `Síntese de ${count} notícias distintas.`;
  return { size: 'standard', sections: selectedSize?.sections.default ?? 3,
    ...(format && selectedSize ? { format, formatSize: selectedSize.id } : {}),
    angle: `${request} Preserve atribuições, datas e números por fonte. Dê a cada notícia espaço proporcional aos fatos disponíveis; não presuma atualidade nem exija o mesmo detalhamento de todas.${angle.trim() ? ` Recorte: ${angle.trim()}` : ''}` };
}
