import { discoveryAddress } from './news-discovery.ts';
import type { NewsSearchConfig } from './news-search.ts';

const plain = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = (value: string) => plain(value).match(/[a-z0-9]+/g) ?? [];
const GENERIC = new Set(['para', 'with', 'from', 'sobre', 'como', 'mais', 'news', 'noticias', 'noticia', 'sector', 'setor',
  'industry', 'industria', 'producao', 'production', 'produccion', 'exportacao', 'exportacion', 'exports', 'export',
  'importacao', 'importacion', 'mercado', 'market', 'markets', 'mercados', 'pesquisa', 'research', 'brasil', 'brazil']);
// Cross-language subject vocabulary keeps the Seafood context useful in international headlines.
const SEAFOOD = ['pesc', 'aquicultur', 'acuicultur', 'aquacultur', 'piscicultur', 'fish', 'seafood', 'tilapia',
  'camarao', 'camaron', 'shrimp', 'prawn', 'salma', 'salmon', 'sardinh', 'sardin', 'bacalhau', 'tuna', 'atum'];

/** A dated search result can still be an index, a paper or an unrelated publication. */
export function isNewsSearchCandidate(config: NewsSearchConfig, item: { url: string; title?: string | null; score?: number }): boolean {
  if (!discoveryAddress(item.url) || item.score !== undefined && item.score < 0.5) return false;
  const url = new URL(item.url);
  const title = plain(item.title ?? '');
  if (title.length < 12 || /^(home|inicio|pagina inicial|pagina principal|homepage)\b/.test(title)
    || /(^|\.)(researchgate\.net|academia\.edu)$/.test(url.hostname)
    || /\/(category|categoria|tag|tags|search|busca|author|autor)(\/|$)/i.test(url.pathname)
    || /^\/?(?:[a-z]{2}(?:-[a-z]{2})?\/?)?$/i.test(url.pathname)
    || /^\/(?:[a-z]{2}\/)?(?:ministerio|secretaria|ministry|department)[^/]*\/?$/i.test(url.pathname)) return false;
  const titleWords = words(title);
  const anchors = words(`${config.sector} ${config.topics.join(' ')}`).filter(word => word.length >= 4 && !GENERIC.has(word));
  if (anchors.some(word => SEAFOOD.some(stem => word.startsWith(stem)))) anchors.push(...SEAFOOD);
  // Require the headline itself to address a configured subject. Long page text can mention
  // fishing incidentally in an annual report or a political speech; it is not enough evidence.
  return titleWords.some(word => anchors.some(anchor => word.startsWith(anchor.replace(/s$/, ''))));
}
