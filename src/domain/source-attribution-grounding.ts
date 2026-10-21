import type { SourceRef } from './refs.ts';
import { sourceVersion } from './source.ts';
import type { Source } from './source.ts';

const compact = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu, '');
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DATE = String.raw`(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{4}|\d{4})(?![\d/-])`;
const PUBLICATION = String.raw`(?:site|portal|página|publicação|postagem|vídeo|relatório|documento|artigo|matéria|boletim)`;
const LABEL = /^\p{Lu}[\p{L}\p{N}.&®-]*(?:\s+(?:(?:d[aeo]s?|e|no|na|of|for|the)\s+)?\p{Lu}[\p{L}\p{N}.&®-]*){0,8}/u;
const REPORTING_PREDICATE = /^\s+(?:[oa]s?\s+)?(?:publicou|noticiou|relatou|informou|descreveu)\b/iu;
type Range = { from: number; to: number };

/** A hostname identifies a location, not an author or a medical/scientific authority.
 * Do not mine URL paths, query strings, subdomain fragments or titles for factual terms. */
function hostIdentity(source: Source): string | undefined {
  try {
    const url = new URL(source.sourceUrl!);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
    return compact(url.hostname.replace(/^www\./i, '').replace(/\.(?:com|org|net|gov|edu|co|ac)\.[a-z]{2}$/i, '').replace(/\.[a-z]{2,}$/i, ''));
  } catch { return undefined; }
}

/** Only a reference to a retained, authorized excerpt can supply attribution metadata. */
function referencedResearch(sources: readonly Source[], refs: readonly SourceRef[]): Source[] {
  return sources.filter(source => source.research && source.rights.authorized && refs.some(ref => {
    if (ref.sourceId !== source.id) return false;
    const version = sourceVersion(source, ref.sourceVersion);
    if (!version) return false;
    const locator = ref.locator;
    return locator.type === 'url' && locator.url === source.sourceUrl && Boolean(locator.excerpt.trim())
      && version.content.segments.some(segment => segment.text.includes(locator.excerpt));
  }));
}

function publicationDateMatches(value: string, source: Source): boolean {
  const date = source.research?.publishedOn?.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!date) return false;
  if (/^\d{4}$/.test(value)) return value === date[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value === date[0].slice(0, 10);
  const local = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return Boolean(local && local[3] === date[1] && Number(local[2]) === Number(date[2]) && Number(local[1]) === Number(date[3]));
}

/** Mask only source-identification spans for the lexical guard. The article, quote checks and
 * semantic review keep the untouched text. Metadata never enters the factual evidence corpus. */
export function sourceAttributionGroundingText(text: string, sources: readonly Source[], refs: readonly SourceRef[]): string {
  const ranges: Range[] = [];
  const addDate = (value: string | undefined, from: number, source: Source) => {
    if (value && publicationDateMatches(value, source)) ranges.push({ from, to: from + value.length });
  };
  const datesAround = (from: number, to: number, source: Source) => {
    // “Em 2022, o site X descreveu…” dates that publication, not an event mentioned later.
    const before = new RegExp(String.raw`(?:^|[.!?]\s+|\n)[Ee]m\s+(${DATE}),?\s+(?:o|a|um|uma)\s+$`, 'u').exec(text.slice(0, from));
    if (before && REPORTING_PREDICATE.test(text.slice(to)))
      addDate(before[1], before.index + before[0].indexOf(before[1]), source);
    const after = new RegExp(String.raw`^\s*(?:,\s*)?(?:publicad[oa]\s+em|de)\s+(${DATE})`, 'iu').exec(text.slice(to));
    if (after) addDate(after[1], to + after[0].indexOf(after[1]), source);
  };
  for (const source of referencedResearch(sources, refs)) {
    const identity = hostIdentity(source);
    if (!identity) continue;
    const prefix = new RegExp(String.raw`(?<![\p{L}\p{N}])(${PUBLICATION})(?:\s+(?:publicad[oa]\s+)?(?:em|de)\s+(${DATE}))?\s+(?:(n[oa]s?|d[ao]s?|pel[oa]s?)\s+)?`, 'giu');
    for (const match of text.matchAll(prefix)) {
      // A post hosted on a platform was not necessarily published BY that platform.
      const website = /^(?:site|portal|página)$/iu.test(match[1]);
      if (!website && !/^n[oa]s?$/iu.test(match[3] ?? '')) continue;
      const from = match.index + match[0].length, label = LABEL.exec(text.slice(from))?.[0];
      if (!label || compact(label) !== identity) continue;
      // The website may identify a source location or report, never an unrelated actor.
      if (website && !/(?:^|[^\p{L}\p{N}])(?:n[oa]s?|em)\s+$/iu.test(text.slice(0, match.index))
        && !REPORTING_PREDICATE.test(text.slice(from + label.length))) continue;
      ranges.push({ from, to: from + label.length });
      if (match[2]) addDate(match[2], match.index + match[0].indexOf(match[2]), source);
      datesAround(match.index, from + label.length, source);
    }
    // A title may be named as a title, never used as a bag of supported facts or identities.
    const title = source.title.replace(/^Pesquisa web · /, '').trim();
    if (!title || title.length > 500) continue;
    const namedTitle = new RegExp(String.raw`${PUBLICATION}\s+intitulad[oa]\s+(${escaped(title)})(?![\p{L}\p{N}])`, 'giu');
    for (const match of text.matchAll(namedTitle)) {
      const from = match.index + match[0].length - match[1].length;
      ranges.push({ from, to: from + match[1].length });
      datesAround(match.index, from + match[1].length, source);
    }
  }
  // Mask occurrences, not term values: a second, unsupported use must still fail.
  const chars = text.split('');
  for (const range of ranges) for (let index = range.from; index < range.to; index++) chars[index] = ' ';
  return chars.join('');
}
