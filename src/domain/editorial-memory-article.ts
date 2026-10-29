import { blockText, inlinesText, type ArticleBlock, type ArticleBody } from './article.ts';
import { memorySourceSegment } from './editorial-memory-excerpt.ts';
import { memoryWritingOccurrences } from './editorial-memory-writing.ts';
import { extractQuotes } from './quotes.ts';
import { dedupeRefs, segmentRef, type SourceRef } from './refs.ts';
import type { Source } from './source.ts';

/** Derive literal bank-citation spans from emitted words, never from another collection or version. */
export function memoryArticleReferences(block: ArticleBlock, refs: SourceRef[], sources: readonly Source[]): SourceRef[] {
  const text = blockText(block);
  const quotes = block.type === 'quote' ? [text] : extractQuotes({ type: 'article', title: '', blocks: [block] }).map(quote => quote.text);
  return dedupeRefs(refs.flatMap(ref => {
    if (ref.locator.type !== 'segment') return [ref];
    const segmentId = ref.locator.segmentId;
    const source = sources.find(source => source.id === ref.sourceId);
    const binding = source && memorySourceSegment(source, ref.sourceVersion, ref.locator.segmentId);
    if (!binding || binding.kind !== 'citation') return [ref];
    const original = binding.anchor.excerpt, from = ref.locator.from ?? 0, to = ref.locator.to ?? original.length;
    if (from < 0 || to > original.length || to <= from) return [ref];
    const allowed = original.slice(from, to);
    if (text.includes(allowed)) return [ref];
    const found = quotes.flatMap(quote => {
      const index = quote ? allowed.indexOf(quote) : -1;
      return index < 0 ? [] : [segmentRef(ref.sourceId, ref.sourceVersion, segmentId, { from: from + index, to: from + index + quote.length })];
    });
    // Keep an unresolved reference visible to validation; never make an invalid claim disappear.
    return found.length ? found : [ref];
  }));
}

export type MemoryArticleContentIssue = { blockId: string; source: SourceRef; code: 'memory_source_changed' | 'memory_literal_changed'; message: string };
/** A complete observation belongs in one paragraph/list item and cannot become somebody's speech. */
export function memoryStatisticIssue(block: ArticleBlock, original: string): string | undefined {
  const parts = block.type === 'list' ? block.items.map(inlinesText) : [blockText(block)];
  if (!original || !parts.some(text => text.includes(original))) return 'O dado usado perdeu parte do contexto original. Confira número, unidade, período e qualificadores.';
  if (block.type === 'quote') return 'Um dado estatístico não pode ser apresentado como fala. Mantenha o dado completo em um parágrafo ou item de lista.';
  if (block.type !== 'paragraph' && block.type !== 'list') return 'Mantenha o dado completo em um parágrafo ou item de lista.';
  const quotes = extractQuotes({ type: 'article', title: '', blocks: [block] });
  const text = blockText(block);
  for (let from = text.indexOf(original); from >= 0; from = text.indexOf(original, from + original.length)) {
    const to = from + original.length, before = text.slice(0, from).trimEnd().at(-1), after = text.slice(to).trimStart()[0];
    if (before === '“' && after === '”' || before === '"' && after === '"' || before === '«' && after === '»'
      || quotes.some(quote => quote.range.from <= from && quote.range.to >= to))
      return 'Um dado estatístico não pode ser apresentado como fala. Mantenha o dado completo em um parágrafo ou item de lista.';
  }
}
/** Content checks are independent of current editorial eligibility, which the server rechecks separately. */
export function memoryArticleContentIssues(body: ArticleBody, sources: readonly Source[]): MemoryArticleContentIssue[] {
  const issues: MemoryArticleContentIssue[] = [];
  for (const source of sources) {
    if (!source.memory) continue;
    const occurrences = memoryWritingOccurrences(body, source);
    for (const block of body.blocks) for (const ref of block.sourceRefs ?? []) {
      if (ref.sourceId !== source.id) continue;
      const binding = ref.locator.type === 'segment' ? memorySourceSegment(source, ref.sourceVersion, ref.locator.segmentId) : undefined;
      let code: MemoryArticleContentIssue['code'] = 'memory_literal_changed';
      let message: string | undefined;
      if (!binding || ref.locator.type !== 'segment') { code = 'memory_source_changed'; message = 'Confira a origem da evidência antes de continuar.'; }
      else {
        const segmentId = ref.locator.segmentId, from = ref.locator.from ?? 0, to = ref.locator.to ?? binding.anchor.excerpt.length;
        const matching = occurrences.filter(item => item.blockId === block.id && item.sourceVersion === ref.sourceVersion && item.binding.segmentId === segmentId
          && (binding.kind === 'statistic' || item.sourceFrom === from && item.sourceTo === to));
        if (!matching.length) message = binding.kind === 'statistic' ? 'O dado usado perdeu parte do contexto original. Confira número, unidade, período e qualificadores.'
          : 'A citação usada não corresponde mais ao trecho original. Confira a referência.';
        else if (binding.kind === 'statistic') message = memoryStatisticIssue(block, binding.anchor.excerpt);
      }
      if (message && !issues.some(issue => issue.blockId === block.id && issue.source.sourceId === ref.sourceId && issue.source.sourceVersion === ref.sourceVersion
        && issue.source.locator.type === 'segment' && ref.locator.type === 'segment' && issue.source.locator.segmentId === ref.locator.segmentId))
        issues.push({ blockId: block.id, source: ref, code, message });
    }
  }
  return issues;
}
