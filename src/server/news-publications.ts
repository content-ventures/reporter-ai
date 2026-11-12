import 'server-only';
import { z } from 'zod';
import { canonicalUrl, NEWS_LIMITS } from '../domain/news-intake.ts';
import type { SourceRef } from '../domain/refs.ts';
import { currentSourceVersion, sourceContentHash } from '../domain/source.ts';
import type { Source, TranscriptContent } from '../domain/source.ts';
import { contentHash } from '../domain/text/hash.ts';
import type { WritingSourceCandidate } from '../domain/writing-source.ts';
import { fetchText } from './news-fetch.ts';
import { parseArticlePage } from './news-parse.ts';
import { cacheRead, cacheWrite } from './storage.ts';

type Context = { runId: string; workspaceId: string; actorId: string };
export type PreparedPublications = { sources: Source[]; candidates: WritingSourceCandidate[]; dates: Map<string, string> };
const snapshotSchema = z.object({ retrievedAt: z.iso.datetime(), response: z.object({ status: z.literal(200), url: z.url(),
  text: z.string().max(NEWS_LIMITS.pageBytes), contentType: z.string() }) });

/** Read only the selected publications, before planning; RSS snapshots remain immutable. */
export async function prepareNewsPublications(originals: readonly Source[], context: Context,
  options: { fetch?: typeof fetchText; now?: () => string; legacyNews?: boolean; signal?: AbortSignal; directory?: string } = {}): Promise<PreparedPublications> {
  const eligible = originals.filter(source => source.workspaceId === context.workspaceId && source.rights.authorized
    && !source.memory && !source.research && source.sourceUrl && (source.kind === 'news' || options.legacyNews));
  const batches: { source?: Source; candidates: WritingSourceCandidate[]; originalId: string; date?: string }[] = [];
  // Limit concurrent public reads without holding a PostgreSQL transaction or using a paid provider.
  for (let offset = 0; offset < eligible.length; offset += 3) {
    batches.push(...await Promise.all(eligible.slice(offset, offset + 3).map(async original => {
      const empty = { candidates: [] as WritingSourceCandidate[], originalId: original.id };
      if (options.signal?.aborted) return empty;
      try {
        const key = 'publisher-page-' + contentHash({ workspace: context.workspaceId, id: original.id,
          hash: currentSourceVersion(original).hash, url: original.sourceUrl });
        const cached = options.directory ? snapshotSchema.safeParse(await cacheRead(options.directory, key)) : undefined;
        const response = cached?.success ? cached.data.response : await (options.fetch ?? fetchText)(original.sourceUrl!, { maxBytes: NEWS_LIMITS.pageBytes,
          accept: 'text/html,application/xhtml+xml', signal: options.signal });
        if (response.status !== 200 || options.signal?.aborted
          || canonicalUrl(response.url) !== canonicalUrl(original.sourceUrl!)) return empty;
        const retrievedAt = cached?.success ? cached.data.retrievedAt : (options.now ?? (() => new Date().toISOString()))();
        if (options.directory && !cached?.success) await cacheWrite(options.directory, key, { response, retrievedAt });
        const page = parseArticlePage(response.text, response.url);
        if (!page) return empty;
        const date = page.publishedAt?.match(/^\d{4}-\d{2}-\d{2}(?=T|$)/)?.[0];
        const publishedOn = date && Number.isFinite(Date.parse(page.publishedAt!))
          && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date ? date : undefined;
        const paragraphs: string[] = [];
        let characters = 0;
        for (const text of [...new Set(page.paragraphs ?? [])]) {
          if (characters + text.length > NEWS_LIMITS.bodyChars) break;
          if (text.trim()) { paragraphs.push(text); characters += text.length; }
        }
        const originalLength = currentSourceVersion(original).content.segments.reduce((sum, segment) => sum + segment.text.length, 0);
        if (page.contentKind === 'search' || !characters || characters <= originalLength && !publishedOn) return { ...empty, date: publishedOn };
        const id = 'publication-' + contentHash({ runId: context.runId, original: original.id, url: response.url, paragraphs, publishedOn });
        const content: TranscriptContent = { type: 'transcript', format: 'plain',
          segments: paragraphs.map((text, index) => ({ id: `${id}-${index + 1}`, text })) };
        const source: Source = { id, workspaceId: context.workspaceId, kind: 'news',
          title: page.outlet ? `${page.outlet}: ${page.title ?? original.title}` : original.title,
          origin: 'other', sourceUrl: original.sourceUrl, ...(publishedOn ? { publishedOn } : {}), speakers: [],
          research: { provider: 'publisher', runId: context.runId, query: original.sourceUrl!, originalSourceId: original.id,
            retrievedAt, publishedOn: publishedOn ?? null },
          rights: { authorized: true, note: 'Publicação original selecionada, consultada para esta geração; o material recebido foi preservado.' },
          versions: [{ number: 1, hash: sourceContentHash(content), content, createdAt: retrievedAt, createdBy: context.actorId }],
          createdAt: retrievedAt, createdBy: context.actorId };
        const candidates = content.segments.map(segment => {
          const ref: SourceRef = { kind: 'source', sourceId: source.id, sourceVersion: 1,
            locator: { type: 'url', url: original.sourceUrl!, excerpt: segment.text, retrievedAt } };
          return { key: 'source-' + contentHash(ref), text: segment.text, ref };
        });
        return { source, candidates, originalId: original.id, date: publishedOn };
      } catch { return empty; }
    })));
  }
  return { sources: batches.flatMap(batch => batch.source ? [batch.source] : []), candidates: batches.flatMap(batch => batch.candidates),
    dates: new Map(batches.flatMap(batch => batch.date ? [[batch.originalId, batch.date] as const] : [])) };
}
