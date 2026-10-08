import type { ArticleBlock, ArticleBody, BlockId, SourceId } from '../domain/index.ts';
import type { ArticleDraftScript, RewriteVariant, ScriptBook, SlideCopy } from '../ports/index.ts';

/**
 * The fixtures' implementation of the `ScriptBook` port: hand-written outputs the simulated
 * generation streams for fixture sources. A pasted source has no entry and goes through the
 * adapter's extractive path (never invented). Every block carries `sourceRefs` into the source
 * version it was written from, and every quotation matches the transcript (integrity test).
 */

export type { ArticleDraftScript, RewriteVariant, ScriptBook, ScriptSection, SlideCopy } from '../ports/index.ts';

export type ScriptEntry = {
  sourceId: SourceId;
  draft?: ArticleDraftScript;
  /** Whole-block rewrites keyed by block id (ids are stable across versions). */
  rewrites?: Record<BlockId, Partial<Record<RewriteVariant, string>>>;
  titles?: string[];
  /** "Sugerir intertítulos": alternatives for the section headings, in order. */
  subheadings?: string[];
  carousel?: SlideCopy[];
};

export function createScriptBook(entries: readonly ScriptEntry[]): ScriptBook {
  const bySource = new Map(entries.map((entry) => [entry.sourceId, entry]));
  return {
    sourceIds: () => [...bySource.keys()],
    draft: (sourceId) => {
      const draft = bySource.get(sourceId)?.draft;
      return draft ? structuredClone(draft) : undefined;
    },
    rewrite: (sourceId, blockId, variant) => bySource.get(sourceId)?.rewrites?.[blockId]?.[variant],
    titles: (sourceId) => [...(bySource.get(sourceId)?.titles ?? [])],
    subheadings: (sourceId) => [...(bySource.get(sourceId)?.subheadings ?? [])],
    carousel: (sourceId) => bySource.get(sourceId)?.carousel?.map((slide) => structuredClone(slide)),
  };
}

/** The full body a draft script produces (what "v1 · IA" contains when the run completes). */
export function scriptBody(script: ArticleDraftScript): ArticleBody {
  const body: ArticleBody = {
    type: 'article',
    title: script.title,
    blocks: script.sections.flatMap((section) => section.blocks.map((block) => structuredClone(block))),
  };
  if (script.coverSlot) body.coverSlot = structuredClone(script.coverSlot);
  return body;
}

/** Blocks written before `sectionId` (exclusive): what a run interrupted at that section keeps. */
export function blocksBefore(script: ArticleDraftScript, sectionId: string): ArticleBlock[] {
  const index = script.sections.findIndex((section) => section.id === sectionId);
  const sections = index < 0 ? script.sections : script.sections.slice(0, index);
  return sections.flatMap((section) => section.blocks.map((block) => structuredClone(block)));
}
