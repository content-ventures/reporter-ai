import { blockText, articleStats } from './article.ts';
import type { ArticleBody } from './article.ts';
import { articlePolicyMessage, r1ArticleQuotationIssue } from './article-policy.ts';
import type { ArticleLengthLimits, ArticlePolicyIssue } from './article-policy.ts';
import { articleContractFor, articleGateFor } from './formats.ts';
import type { FormatBrief } from './formats.ts';
import { ungroundedTerms } from './grounding.ts';
import { currentSourceVersion } from './source.ts';
import type { Source } from './source.ts';
import type { SourceRef } from './refs.ts';
import { sourceAttributionGroundingText } from './source-attribution-grounding.ts';
import type { WritingReview } from './writing-orchestration.ts';

/** Collect every objective failure before spending the one permitted correction. */
export function writingArticleChecks(body: ArticleBody, sources: readonly Source[], brief: FormatBrief, extraCorpus: readonly string[] = [],
  options?: { minimumQuotes: number; titleSourceRefs?: readonly SourceRef[]; dekSourceRefs?: readonly SourceRef[] }): WritingReview['issues'] {
  const limits: ArticleLengthLimits & { minQuotes: number } = writingArticleLimits(brief, options?.minimumQuotes), stats = articleStats(body);
  const codes: ArticlePolicyIssue[] = [];
  if (limits.minChars !== undefined && stats.characters < limits.minChars) codes.push('ARTICLE_SIZE_TOO_SHORT');
  if (limits.maxChars !== undefined && stats.characters > limits.maxChars) codes.push('ARTICLE_SIZE_EXCEEDED');
  if (limits.minWords !== undefined && stats.words < limits.minWords) codes.push('ARTICLE_WORDS_TOO_FEW');
  if (limits.maxWords !== undefined && stats.words > limits.maxWords) codes.push('ARTICLE_WORDS_EXCEEDED');
  const quoteIssue = r1ArticleQuotationIssue(body, sources, limits.minQuotes);
  if (quoteIssue) codes.push(quoteIssue);
  const issues: WritingReview['issues'] = codes.map(code => ({ id: `contract-${code}`, severity: 'major', code, blockId: '$article', evidenceIds: [],
    message: `${articlePolicyMessage(code, { ...articleContractFor(brief), minQuotes: limits.minQuotes })} Contagem atual: ${stats.characters} caracteres e ${stats.words} palavras.`,
    suggestion: 'Corrija o conjunto de pendências com os fatos disponíveis, preservando as ressalvas e citações. Se faltar conteúdo, sinalize necessidade de apuração.' }));
  if (brief.format) {
    const corpus = [...sources.flatMap(source => currentSourceVersion(source).content.segments.map(segment => (segment.speaker ? segment.speaker + ': ' : '') + segment.text)),
      ...sources.flatMap(source => source.recordedOn ? [source.recordedOn] : []),
      ...Object.values(brief.event ?? {}), ...extraCorpus].join('\n');
    const passages = [{ text: body.title, refs: options?.titleSourceRefs ?? [] }, { text: body.dek ?? '', refs: options?.dekSourceRefs ?? [] },
      ...body.blocks.map(block => ({ text: blockText(block), refs: block.sourceRefs ?? [] }))];
    const missing = [...new Set(passages.flatMap(({ text, refs }) => ungroundedTerms(sourceAttributionGroundingText(text, sources, refs), corpus)))];
    if (missing.length) issues.push({ id: 'contract-UNGROUNDED_FACT', severity: 'major', code: 'UNGROUNDED_FACT', blockId: '$article', evidenceIds: [],
      message: `Confira termos sem correspondência no conteúdo ou nos dados confirmados: ${missing.slice(0, 20).map(term => term.slice(0, 80)).join(', ')}${missing.length > 20 ? ` e mais ${missing.length - 20}` : ''}.`,
      suggestion: 'Confira nomes e números no material original. Use somente dados sustentados ou sinalize necessidade de apuração; não substitua por novos dados inventados.' });
  }
  return issues;
}

/** Only orchestration explicitly overrides the historical format quotation contract. */
export function writingArticleLimits(brief: FormatBrief, minimumQuotes?: number) {
  return { ...articleGateFor(brief), ...(minimumQuotes === undefined ? {} : { minQuotes: minimumQuotes }) };
}
