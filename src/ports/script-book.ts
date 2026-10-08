import type { ArticleBlock } from '../domain/article.ts';
import type { BlockId, SourceId } from '../domain/ids.ts';
import type { Brief } from '../domain/production.ts';
import type { SourceRef } from '../domain/refs.ts';
import type { OutlineSection } from '../domain/run-events.ts';
import type { RewriteTone } from './generation.ts';

/**
 * Hand-written outputs for the fictional fixture material, streamed by the simulated generation
 * adapter instead of its extractive fallback. The fixtures module implements it and the runtime
 * injects it (adapters never import fixtures). Material without a script goes through the
 * EXTRACTIVE path: nothing invented, never the whole transcript.
 *
 * Script rules (checked by the generation contract suite and the fixtures integrity test):
 * - every `SourceRef` resolves in `sourceVersion` of the source (segment id + range);
 * - quotations (quote blocks and text between “ ”) match the transcript verbatim;
 * - block ids are unique inside a script; they are kept, so `rewrite(blockId)` keeps working.
 */

/** One streamed unit: `intro` or a brief section (`section-1`…), matching the recipe step ids. */
export type ScriptSection = { id: string; label: string; blocks: ArticleBlock[] };

export type ArticleDraftScript = {
  sourceId: SourceId;
  /** The script applies only while the source is at this version (a correction makes it stale). */
  sourceVersion: number;
  /**
   * The brief it was written for. Once the production's brief is another one (sections, length or
   * angle edited), the script no longer applies and "Gerar nova versão" writes from the material.
   */
  brief?: Pick<Brief, 'angle' | 'sections' | 'length'>;
  title: string;
  /** "Selecionando falas-chave" (`source.used`). */
  keySegments: SourceRef[];
  /** "Montando estrutura" (`outline`): the section headings. */
  outline: OutlineSection[];
  /** Introduction first, then one entry per section (its heading block first). */
  sections: ScriptSection[];
};

/** Slide text for one slide: layout id, slot texts and the article blocks it came from. */
export type SlideCopy = { layout: string; slots: Record<string, string>; sourceBlockIds: BlockId[] };

/** Rewrite variants of a whole block: the three tones, "Encurtar" and the fix a review note asks for. */
export type RewriteVariant = RewriteTone | 'shorter' | 'note';

export interface ScriptBook {
  /** Sources with hand-written outputs. */
  sourceIds(): SourceId[];
  draft(sourceId: SourceId): ArticleDraftScript | undefined;
  /** Replacement for a whole block, or undefined (the adapter then transforms the text). */
  rewrite(sourceId: SourceId, blockId: BlockId, variant: RewriteVariant): string | undefined;
  titles(sourceId: SourceId): string[];
  /** "Sugerir intertítulos": alternatives for the section headings, in order. */
  subheadings(sourceId: SourceId): string[];
  /** Slide copy written from the article of this source. */
  carousel(sourceId: SourceId): SlideCopy[] | undefined;
}

/** No hand-written outputs: everything goes through the extractive path. */
export const EMPTY_SCRIPT_BOOK: ScriptBook = {
  sourceIds: () => [],
  draft: () => undefined,
  rewrite: () => undefined,
  titles: () => [],
  subheadings: () => [],
  carousel: () => undefined,
};
