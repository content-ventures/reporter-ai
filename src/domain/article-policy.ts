import { articleStats, blockText } from './article.ts';
import type { ArticleBody } from './article.ts';
import { resolveSourceRef } from './source.ts';
import type { Source } from './source.ts';
import type { CheckResult } from './checks.ts';
import { countWords } from './text/stats.ts';

/** R1: simultaneous, inclusive limits on the body; never pad unsupported material. */
export const R1_ARTICLE_LIMITS = {
  minChars: 2500, maxChars: 4000, targetChars: 3900,
  minWords: 500, maxWords: 800, targetWords: 700, minQuotes: 2,
} as const;
export type ArticleLengthLimits = {
  minChars?: number; maxChars?: number; minWords?: number; maxWords?: number;
};
export type ArticlePolicyIssue = 'ARTICLE_SIZE_TOO_SHORT' | 'ARTICLE_SIZE_EXCEEDED'
  | 'ARTICLE_WORDS_TOO_FEW' | 'ARTICLE_WORDS_EXCEEDED' | 'ARTICLE_QUOTES_REQUIRED'
  | 'UNSUPPORTED_ARTICLE_QUOTE' | 'UNKNOWN_EVIDENCE';

export function articleLengthIssue(stats: { characters: number; words: number }, limits: ArticleLengthLimits): ArticlePolicyIssue | undefined {
  if (limits.maxChars !== undefined && stats.characters > limits.maxChars) return 'ARTICLE_SIZE_EXCEEDED';
  if (limits.minChars !== undefined && stats.characters < limits.minChars) return 'ARTICLE_SIZE_TOO_SHORT';
  if (limits.maxWords !== undefined && stats.words > limits.maxWords) return 'ARTICLE_WORDS_EXCEEDED';
  if (limits.minWords !== undefined && stats.words < limits.minWords) return 'ARTICLE_WORDS_TOO_FEW';
}

/** Only Unicode composition and whitespace vary; no fuzzy words, elisions or paraphrases. */
export function literalQuoteText(text: string) { return text.normalize('NFC').replace(/\s+/gu, ' ').trim(); }
export function directQuotes(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”|"([^"]+)"|«([^»]+)»/gu)].map(match => match[1] ?? match[2] ?? match[3]);
}
export function articleQuotationIssue(paragraphs: readonly { text: string; evidenceIds: readonly string[] }[],
  evidence: ReadonlyMap<string, string>, minimum = 0): ArticlePolicyIssue | undefined {
  const distinct = new Set<string>();
  for (const paragraph of paragraphs) {
    if (paragraph.evidenceIds.some(id => !evidence.has(id))) return 'UNKNOWN_EVIDENCE';
    const quoted = directQuotes(paragraph.text);
    // Unclosed quotes must not bypass literal validation.
    const delimiters = paragraph.text.match(/[“”"«»]/gu)?.length ?? 0;
    if (delimiters !== quoted.length * 2) return 'UNSUPPORTED_ARTICLE_QUOTE';
    for (const quote of quoted) {
      const literal = literalQuoteText(quote);
      if (!literal || !paragraph.evidenceIds.some(id => literalQuoteText(evidence.get(id) ?? '').includes(literal)))
        return 'UNSUPPORTED_ARTICLE_QUOTE';
      // A quoted brand name is not one of the required substantive quotations.
      if (countWords(literal) >= 4) distinct.add(literal);
    }
  }
  if (distinct.size < minimum) return 'ARTICLE_QUOTES_REQUIRED';
}

/** The same contract also protects sending a manually edited draft for approval. */
export function r1ArticleIssue(body: ArticleBody, sources: readonly Source[]): ArticlePolicyIssue | undefined {
  return articleLengthIssue(articleStats(body), R1_ARTICLE_LIMITS) ?? r1ArticleQuotationIssue(body, sources);
}
export function r1ArticleQuotationIssue(body: ArticleBody, sources: readonly Source[]): ArticlePolicyIssue | undefined {
  const evidence = new Map<string, string>();
  const paragraphs = body.blocks.filter(block => block.type === 'paragraph' || block.type === 'quote' || block.type === 'heading' || block.type === 'list').map(block => {
    const evidenceIds = (block.sourceRefs ?? []).flatMap(ref => {
      const resolved = resolveSourceRef(sources, ref);
      if (!resolved) return [];
      const id = JSON.stringify(ref);
      evidence.set(id, resolved.excerpt);
      return [id];
    });
    const text = blockText(block);
    return { text: block.type === 'quote' && !directQuotes(text).length ? `“${text}”` : text, evidenceIds };
  });
  return articleQuotationIssue(paragraphs, evidence, R1_ARTICLE_LIMITS.minQuotes);
}

/** Shared by persisted read models and live, unsaved editor content. */
export function enforceR1ArticleChecks(checks: readonly CheckResult[], body: ArticleBody, sources: readonly Source[]): CheckResult[] {
  const length = articleLengthIssue(articleStats(body), R1_ARTICLE_LIMITS);
  const quotes = r1ArticleQuotationIssue(body, sources);
  return checks.map(check => {
    if (check.id !== 'article.length' && check.id !== 'article.quotes') return check;
    const issue = check.id === 'article.length' ? length : quotes;
    return { ...check, blocking: true, status: issue ? 'fail' as const : 'pass' as const,
      ...(issue ? { detail: ARTICLE_POLICY_MESSAGES[issue] } : {}) };
  });
}

export const ARTICLE_POLICY_MESSAGES: Record<ArticlePolicyIssue, string> = {
  ARTICLE_SIZE_TOO_SHORT: 'O artigo precisa de pelo menos 2.500 caracteres no corpo. Desenvolva mais fatos da fonte, sem repetir ou inventar.',
  ARTICLE_SIZE_EXCEEDED: 'O corpo do artigo excedeu 4.000 caracteres. Encurte sem cortar frases ou remover ressalvas essenciais.',
  ARTICLE_WORDS_TOO_FEW: 'O corpo do artigo precisa de pelo menos 500 palavras, além de cumprir os limites de caracteres.',
  ARTICLE_WORDS_EXCEEDED: 'O corpo do artigo excedeu 800 palavras. Encurte mantendo as informações essenciais.',
  ARTICLE_QUOTES_REQUIRED: 'O artigo precisa de pelo menos duas citações literais distintas da transcrição, com suas referências. Selecione falas na estrutura.',
  UNSUPPORTED_ARTICLE_QUOTE: 'Uma citação não corresponde literalmente à evidência referenciada. Confira a transcrição; não transforme paráfrase em aspas.',
  UNKNOWN_EVIDENCE: 'Uma referência do artigo não existe na fonte. Confira os trechos selecionados na estrutura.',
};
