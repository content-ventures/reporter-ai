import type { ArticleBody, Inline } from './article.ts';
import { blockText } from './article.ts';
import { extractQuotes } from './quotes.ts';
import { literalQuoteText, quoteSpelling } from './article-policy.ts';
import { contentHash } from './text/hash.ts';
import { countWords } from './text/stats.ts';
import { segmentPlace, sourceVersion } from './source.ts';
import type { SegmentPlace, Source } from './source.ts';
import type { SourceRef } from './refs.ts';
import type { Person } from './workspace.ts';
import type { FactCheck } from './fact-check.ts';

/** Literal words and their immutable transcript version; editorial metadata never rewrites them. */
export type Citation = {
  id: string; revision: number; text: string; ref: SourceRef; sourceHash: string;
  productionId: string; createdAt: string; updatedAt: string;
  personId?: string; authorConfirmed: boolean; relevance: string;
  podcastName?: string; podcastUrl?: string; recordedOn?: string; location?: string;
};
export type CitationInput = {
  sourceId: string; sourceVersion: number; text: string; productionId: string;
  personId?: string; authorConfirmed: boolean; relevance: string;
  podcastName?: string; podcastUrl?: string; recordedOn?: string; location?: string;
};
/** A production whose article (draft or version) carries the citation. */
export type CitationUse = { productionId: string; title: string; at: string };
export type CitationView = Citation & {
  /** `startMs` is the material's continuous time; `place` tells the part of a material sent in parts. */
  speaker: string; podcast: string; sourceTitle: string; startMs?: number; place?: SegmentPlace;
  evidence: string; authorized: boolean; ready: boolean;
  participants: { id: string; name: string }[];
  /** Newest use first; one entry per production. */
  uses: CitationUse[];
  factCheck?: FactCheck;
};
export type CitationLibraryView = {
  items: CitationView[];
  sources: { id: string; version: number; title: string; productionId: string }[];
};

export function podcastLink(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2000 ? url.href : undefined;
  } catch { return undefined; }
}
export function citationDay(value: string | undefined): boolean {
  if (!value) return true;
  const day = new Date(value+'T12:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(day.getTime()) && day.toISOString().slice(0,10) === value;
}
/** Exact substring in ONE segment. Never assign an unlabeled voice to an introduced participant. */
export function locateCitation(source: Source, versionNumber: number, text: string,preferredSegment?: string) {
  const version = sourceVersion(source, versionNumber), quoted = literalQuoteText(text);
  if (!version || quoted.length < 24 || quoted.length > 1200 || countWords(quoted) < 4) return undefined;
  const segment = version.content.segments.find(segment => (!preferredSegment || segment.id === preferredSegment) && quoteSpelling(literalQuoteText(segment.text), quoted) !== undefined);
  if (!segment) return undefined;
  // The library keeps the words as the source writes them, even when the article opens them with a capital.
  const literal = quoteSpelling(literalQuoteText(segment.text), quoted)!;
  const speaker = segment.speaker ? source.speakers.find(speaker => speaker.label === segment.speaker) : undefined;
  const ref: SourceRef = { kind: 'source', sourceId: source.id, sourceVersion: version.number,
    locator: { type: 'segment', segmentId: segment.id } };
  return { text: literal, ref, hash: version.hash, segment,
    personId: speaker?.unattributed ? undefined : speaker?.personId };
}
export function citationId(ref: SourceRef, text: string) {
  return contentHash({ sourceId: ref.sourceId, version: ref.sourceVersion, text: literalQuoteText(text) });
}
/** The article pipeline already curated these passages; still pending editorial relevance review. */
export function citationsFromArticle(body: ArticleBody, sources: readonly Source[], productionId: string, now: string): Citation[] {
  const found = new Map<string, Citation>();
  for (const quote of extractQuotes(body)) {
    for (const ref of quote.sourceRefs) {
      const source = sources.find(source => source.id === ref.sourceId);
      if (!source?.rights.authorized || ref.locator.type !== 'segment') continue;
      const segmentId = ref.locator.segmentId;
      const segment = sourceVersion(source, ref.sourceVersion)?.content.segments.find(segment => segment.id === segmentId);
      if (!segment || quoteSpelling(literalQuoteText(segment.text), literalQuoteText(quote.text)) === undefined) continue;
      const located = locateCitation(source,ref.sourceVersion,quote.text,segmentId);
      if (!located) continue;
      const id = citationId(located.ref, located.text);
      found.set(id, { id, revision: 0, text: located.text, ref: located.ref, sourceHash: located.hash,
        productionId, createdAt: now, updatedAt: now, authorConfirmed: Boolean(located.personId),
        ...(located.personId ? { personId: located.personId } : {}), relevance: '',
        ...(source.programName ? { podcastName: source.programName } : {}),
        ...(source.sourceUrl ? { podcastUrl: source.sourceUrl } : {}),
        ...(source.recordedOn ? { recordedOn: source.recordedOn } : {}),
        ...(source.location ? { location: source.location } : {}) });
      break;
    }
  }
  return [...found.values()];
}
/** Groups article appearances by citation: one use per production, the latest date kept, newest first. */
export function citationUses(appearances: readonly (CitationUse & { citationId: string })[]): Map<string, CitationUse[]> {
  const grouped = new Map<string, Map<string, CitationUse>>();
  for (const { citationId, ...use } of appearances) {
    const uses = grouped.get(citationId) ?? new Map<string, CitationUse>();
    const known = uses.get(use.productionId);
    if (!known || known.at < use.at) uses.set(use.productionId, use);
    grouped.set(citationId, uses);
  }
  return new Map([...grouped].map(([id, uses]) => [id, [...uses.values()].sort((a, b) => b.at.localeCompare(a.at))]));
}
export function citationView(citation: Citation, source: Source, people: readonly Person[],
  extra: { uses?: CitationUse[]; factCheck?: FactCheck } = {}): CitationView {
  const version = sourceVersion(source, citation.ref.sourceVersion);
  const segmentId = citation.ref.locator.type === 'segment' ? citation.ref.locator.segmentId : undefined;
  const segment = version?.content.segments.find(segment => segment.id === segmentId);
  const place = segment && segmentPlace(source, segment);
  const person = citation.authorConfirmed ? people.find(person => person.id === citation.personId) : undefined;
  const authorized = source.rights.authorized && version?.hash === citation.sourceHash
    && Boolean(segment && literalQuoteText(segment.text).includes(citation.text));
  return { ...citation, speaker: person?.name ?? 'Autoria a confirmar', podcast: citation.podcastName || source.programName || 'Podcast não informado',
    sourceTitle: source.title, evidence: segment?.text ?? '', authorized,
    ready: Boolean(authorized && person && citation.relevance.trim()),
    ...(segment?.startMs === undefined ? {} : { startMs: segment.startMs }),
    ...(place ? { place } : {}),
    uses: extra.uses ?? [], ...(extra.factCheck ? { factCheck: extra.factCheck } : {}),
    participants: [...new Set(source.speakers.flatMap(speaker => speaker.personId ? [speaker.personId] : []))]
      .flatMap(id => { const person = people.find(person => person.id === id); return person ? [{ id, name: person.name }] : []; }) };
}
export function citationCopy(citation: CitationView) {
  return `“${citation.text}”\n— ${citation.speaker}\n${[citation.podcast, citation.location, citation.recordedOn, citation.podcastUrl].filter(Boolean).join(' · ')}`;
}
/** Visible typography only. Plain text, references, quotes and lauda counts are unchanged. */
export function emphasizeArticleQuotes(body: ArticleBody): ArticleBody {
  return { ...body, blocks: body.blocks.map(block => {
    if (block.type !== 'paragraph' && block.type !== 'quote') return block;
    const text = blockText(block);
    const ranges = [...text.matchAll(/“([^”]+)”|"([^"]+)"|«([^»]+)»/gu)].filter(match => countWords(match[1] ?? match[2] ?? match[3]) >= 4)
      .map(match => ({ from: match.index!, to: match.index!+match[0].length }));
    if (!ranges.length) return block;
    let offset = 0;
    const inlines: Inline[] = block.inlines.flatMap(inline => {
      const start = offset, end = offset+inline.text.length; offset = end;
      const points = [...new Set([start, end, ...ranges.flatMap(range => [range.from, range.to]).filter(point => point > start && point < end)])].sort((a,b) => a-b);
      return points.slice(0,-1).map((from,index) => ({ ...inline, text: inline.text.slice(from-start,points[index+1]-start),
        ...(ranges.some(range => from >= range.from && from < range.to) ? { marks: [...new Set([...(inline.marks ?? []), 'bold' as const])] } : {}) }));
    });
    return { ...block, inlines };
  }) };
}
