import { blockText, findBlock, headingBlock, listBlock, paragraphBlock, quoteBlock } from '../../domain/index.ts';
import type { AiReviewState, ArticleBlock, ArticleBody, BlockId, DecisionAnchor, Source } from '../../domain/index.ts';
import type { ArticleDraftScript, ScriptSection } from '../script-book.ts';
import { excerptRef } from './source.ts';

/**
 * A tiny authoring DSL for hand-written articles. Evidence is written as exact excerpts of the
 * transcript and resolved to `SourceRef`s with character ranges, so a typo fails the build.
 */

export type BlockSpec =
  | { kind: 'paragraph'; id: BlockId; text: string; refs: string[] }
  | { kind: 'heading'; id: BlockId; text: string; level: 2 | 3 }
  | { kind: 'quote'; id: BlockId; text: string; refs: string[] }
  | { kind: 'list'; id: BlockId; items: string[]; ordered: boolean; refs: string[] };

export function p(id: BlockId, text: string, ...refs: string[]): BlockSpec {
  return { kind: 'paragraph', id, text, refs };
}

export function h2(id: BlockId, text: string): BlockSpec {
  return { kind: 'heading', id, text, level: 2 };
}

/** A block quotation; without explicit refs the quote itself is the excerpt. */
export function quote(id: BlockId, text: string, ...refs: string[]): BlockSpec {
  return { kind: 'quote', id, text, refs: refs.length > 0 ? refs : [text] };
}

export function ul(id: BlockId, items: string[], ...refs: string[]): BlockSpec {
  return { kind: 'list', id, items, ordered: false, refs };
}

export type SectionSpec = { id: string; blocks: BlockSpec[] };

export type ArticleSpec = {
  title: string;
  /** Excerpts announced as key lines while the run selects material. */
  keyExcerpts: string[];
  /** `intro` first, then `section-1`…`section-n` (ids match the recipe steps). */
  sections: SectionSpec[];
};

export function buildBlock(source: Source, spec: BlockSpec, ai?: AiReviewState): ArticleBlock {
  const options = ai ? { ai } : {};
  switch (spec.kind) {
    case 'heading':
      return headingBlock(spec.id, spec.text, spec.level, options);
    case 'paragraph':
      return paragraphBlock(spec.id, spec.text, { ...options, sourceRefs: spec.refs.map((excerpt) => excerptRef(source, excerpt)) });
    case 'quote':
      return quoteBlock(spec.id, spec.text, { ...options, sourceRefs: spec.refs.map((excerpt) => excerptRef(source, excerpt)) });
    case 'list':
      return listBlock(spec.id, spec.items, spec.ordered, { ...options, sourceRefs: spec.refs.map((excerpt) => excerptRef(source, excerpt)) });
  }
}

function sectionLabel(section: SectionSpec): string {
  if (section.id === 'intro') return 'Introdução';
  const heading = section.blocks.find((block) => block.kind === 'heading');
  return heading?.kind === 'heading' ? heading.text : section.id;
}

/** Freezes an authored article into the script the simulated run streams (all blocks unreviewed AI). */
export function buildDraftScript(source: Source, spec: ArticleSpec): ArticleDraftScript {
  const version = source.versions[source.versions.length - 1];
  const sections: ScriptSection[] = spec.sections.map((section) => ({
    id: section.id,
    label: sectionLabel(section),
    blocks: section.blocks.map((block) => buildBlock(source, block, 'unreviewed')),
  }));
  const ids = sections.flatMap((section) => section.blocks.map((block) => block.id));
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate block ids in the script for ${source.id}`);
  return {
    sourceId: source.id,
    sourceVersion: version.number,
    title: spec.title,
    keySegments: spec.keyExcerpts.map((excerpt) => excerptRef(source, excerpt)),
    outline: sections
      .filter((section) => section.id !== 'intro')
      .map((section) => {
        const heading = section.blocks.find((block) => block.type === 'heading');
        return heading ? { blockId: heading.id, title: blockText(heading) } : { title: section.label };
      }),
    sections,
  };
}

/** Edits a person makes on top of a version (each edit marks the touched AI block as reviewed). */
export type ArticleEdit =
  | { type: 'text'; blockId: BlockId; text: string }
  | { type: 'review'; blockIds: BlockId[] }
  | { type: 'remove'; blockId: BlockId }
  | { type: 'insert'; after: BlockId; block: BlockSpec }
  | { type: 'title'; text: string };

function reviewed(block: ArticleBlock): ArticleBlock {
  return block.ai === 'unreviewed' ? { ...block, ai: 'reviewed' } : block;
}

function withText(block: ArticleBlock, text: string): ArticleBlock {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
    case 'quote':
      return reviewed({ ...block, inlines: text ? [{ text }] : [] });
    case 'list':
      return reviewed({ ...block, items: text.split('\n').map((item) => [{ text: item }]) });
    case 'divider':
    case 'figure':
      return block;
  }
}

export function applyEdits(source: Source, body: ArticleBody, edits: readonly ArticleEdit[]): ArticleBody {
  let next: ArticleBody = structuredClone(body);
  for (const edit of edits) {
    if (edit.type === 'title') {
      next = { ...next, title: edit.text };
      continue;
    }
    if (edit.type === 'insert') {
      const index = next.blocks.findIndex((block) => block.id === edit.after);
      if (index < 0) throw new Error(`Unknown block ${edit.after}`);
      const blocks = next.blocks.slice();
      blocks.splice(index + 1, 0, buildBlock(source, edit.block));
      next = { ...next, blocks };
      continue;
    }
    const ids = edit.type === 'review' ? edit.blockIds : [edit.blockId];
    for (const id of ids) {
      if (!next.blocks.some((block) => block.id === id)) throw new Error(`Unknown block ${id}`);
    }
    if (edit.type === 'remove') next = { ...next, blocks: next.blocks.filter((block) => block.id !== edit.blockId) };
    else if (edit.type === 'review') next = { ...next, blocks: next.blocks.map((block) => (ids.includes(block.id) ? reviewed(block) : block)) };
    else next = { ...next, blocks: next.blocks.map((block) => (block.id === edit.blockId ? withText(block, edit.text) : block)) };
  }
  return next;
}

/** Marks every AI block of a body as reviewed (an editor who went through the whole text). */
export function reviewAll(body: ArticleBody): ArticleBody {
  return { ...body, blocks: body.blocks.map(reviewed) };
}

/** A reviewer's anchor on an exact passage of a version ("Devolver com nota" pointing at text). */
export function anchorOn(body: ArticleBody, blockId: BlockId, excerpt?: string): DecisionAnchor {
  const block = findBlock(body, blockId);
  if (!block) throw new Error(`Unknown block ${blockId}`);
  const text = blockText(block);
  const passage = excerpt ?? text;
  const from = text.indexOf(passage);
  if (from < 0 || text.indexOf(passage, from + 1) >= 0) throw new Error(`Anchor must occur once in ${blockId}: "${passage}"`);
  return { blockId, from, to: from + passage.length, excerpt: passage };
}
