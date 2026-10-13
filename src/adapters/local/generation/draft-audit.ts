import { articleCharacters, blockText } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { resolveSourceRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { foldForMatch } from '../../../domain/text/normalize.ts';
import { readMaterial } from './material.ts';
import { sentenceSpans } from './sentences.ts';

/**
 * Test support (not used by the app): audits a simulated draft against João's rule "a quantidade
 * nunca pode forçar a IA a encher linguiça". A draft pads when it repeats a line, writes a
 * paragraph without a source in the material, uses the interviewer's words as text, or adds words
 * of its own beyond the attribution ("diz Lúcia Prado, fundadora da padaria").
 */

const ATTRIBUTION = /^,\s(?:diz|afirma|conta|explica|observa|completa)\s[^“”]+?\.(?:\s*\.)?$/;

const words = (text: string) => foldForMatch(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const normal = (text: string) => words(text).join(' ');

/** What the draft repeats or adds; empty when it only frames the material. */
export function paddingIn(body: ArticleBody, sources: readonly Source[]): string[] {
  const material = readMaterial(sources);
  const interviewer = new Set(material.lines.filter((line) => material.interviewer && line.speaker === material.interviewer).map((line) => line.segmentId as string));
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const block of body.blocks) {
    if (block.type === 'figure' || block.type === 'divider') continue;
    const text = blockText(block);
    const label = `${block.type} ${block.id}: “${text.slice(0, 50)}…”`;
    const refs = block.sourceRefs ?? [];
    if (refs.length === 0) {
      problems.push(`${label} has no source in the material`);
      continue;
    }
    const cited = refs.map((ref) => {
      const resolved = resolveSourceRef(sources, ref);
      const segment = ref.locator.type === 'segment' ? ref.locator.segmentId : '';
      return { resolved, segment, text: resolved?.segment?.text ?? '' };
    });
    if (cited.some((entry) => !entry.resolved)) problems.push(`${label} cites what the material does not hold`);
    if (block.type === 'heading') continue;
    if (cited.some((entry) => interviewer.has(entry.segment))) problems.push(`${label} uses the interviewer's words as text`);
    const source = normal(cited.map((entry) => entry.text).join(' '));
    // What the reader takes as the source's words: the quotations, or the whole block when unquoted.
    const quoted = [...text.matchAll(/“([^”]+)”/g)].map((match) => match[1]);
    const spoken = quoted.length > 0 || block.type === 'quote' ? (quoted.length > 0 ? quoted : [text]) : [text];
    for (const passage of spoken) {
      const clean = normal(passage.replace(/…$/, ''));
      if (clean && !source.includes(clean)) problems.push(`${label} says “${passage.slice(0, 40)}” that the cited line does not`);
      for (const sentence of sentenceSpans(passage)) {
        const key = normal(sentence.text.replace(/…$/, ''));
        if (words(key).length < 4) continue;
        const where = seen.get(key);
        if (where && where !== block.id) problems.push(`${label} repeats “${sentence.text.slice(0, 40)}”`);
        seen.set(key, block.id);
      }
    }
    if (quoted.length > 0 && block.type === 'paragraph') {
      const residue = text.replace(/“[^”]*”/g, '').trim();
      if (residue && residue !== '.' && !ATTRIBUTION.test(residue)) problems.push(`${label} adds “${residue.slice(0, 40)}” of its own`);
    }
  }
  return problems;
}

export type DraftMeasure = {
  chars: number;
  headings: number;
  paragraphs: number;
  quotes: number;
  figures: number;
  questionHeadings: number;
};

export function measureDraft(body: ArticleBody): DraftMeasure {
  const count = (type: string) => body.blocks.filter((block) => block.type === type).length;
  return {
    chars: articleCharacters(body),
    headings: count('heading'),
    paragraphs: count('paragraph'),
    quotes: count('quote'),
    figures: count('figure'),
    questionHeadings: body.blocks.filter((block) => block.type === 'heading' && blockText(block).trim().endsWith('?')).length,
  };
}
