import 'server-only';
import { z } from 'zod';
import type { PipelineStepKey } from '../domain/pipeline.ts';
import { PIPELINE_SENTENCE_PATTERN } from '../domain/pipeline.ts';
import { articleLengthIssue, articleQuotationIssue } from '../domain/article-policy.ts';
import type { ArticleLengthLimits } from '../domain/article-policy.ts';
import { countCharacters, textStats } from '../domain/text/stats.ts';

export type WritingContract = { limits?: ArticleLengthLimits; evidence: ReadonlyMap<string, string>; minQuotes?: number };

const ids = z.array(z.string());
const paragraph = z.object({ text: z.string().trim().min(1).max(5000).regex(new RegExp(PIPELINE_SENTENCE_PATTERN, 'u')), evidenceIds: ids.min(1).max(30) }).strict();
const section = z.object({ title: z.string().min(1).max(120), paragraphs: z.array(paragraph).min(1).max(10) }).strict();
export const articleAssistOutput = z.object({ reply: z.string().trim().max(3000), changes: z.array(z.object({
  targetIndex: z.number().int().nonnegative(), kind: z.enum(['text', 'list', 'heading', 'title']),
  text: z.string().trim().max(5000), items: z.array(z.string().trim().min(1).max(2000)).max(12),
  evidenceIds: ids.max(30),
}).strict()).max(16) }).strict();
export const imageSuggestionOutput = z.object({ subject: z.string().trim().min(1).max(240),
  suggestedCaption: z.string().max(300), suggestedAlt: z.string().max(300),
  orientation: z.enum(['landscape', 'portrait', 'square']), sourceBlockIds: ids.min(1).max(10) }).strict();
export const imagePlanOutput = z.object({ cover: imageSuggestionOutput.nullable(),
  figures: z.array(imageSuggestionOutput.extend({ afterBlockId: z.string().min(1) })).max(2) }).strict();
const outputs = {
  assist: articleAssistOutput,
  images: imagePlanOutput,
  facts: z.object({ facts: z.array(z.string().min(1).max(3000)).min(1).max(50) }).strict(),
  outline: z.object({ title: z.string().min(1).max(500), introIds: ids.max(2), sections: z.array(z.object({
    title: z.string().min(1).max(120), evidenceIds: ids.min(1).max(20),
  }).strict()).min(1).max(8) }).strict(),
  quotes: z.object({ introIds: ids.max(2), sectionIds: z.array(ids.min(1).max(20)).min(1).max(8) }).strict(),
  intro: z.object({ paragraphs: z.array(paragraph).min(1).max(3) }).strict(),
  section,
  article: z.object({ title: z.string().min(1).max(500), intro: z.array(paragraph).min(1).max(3), sections: z.array(section).min(1).max(8) }).strict(),
  carousel: z.object({ slides: z.record(z.string(), z.object({ slots: z.record(z.string(), z.string().max(2000)), sourceBlockIds: ids.min(1).max(20) }).strict()) }).strict(),
};
/** Enforce production-specific length contracts locally as well as in vendor grammars. */
export function withinPipelineSchema(value: unknown, schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const rule = schema as { pattern?: string; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; items?: unknown; properties?: Record<string, unknown> };
  if (typeof value === 'string' && (rule.minLength !== undefined && value.length < rule.minLength || rule.maxLength !== undefined && value.length > rule.maxLength)) return false;
  if (typeof value === 'string' && rule.pattern !== undefined && !new RegExp(rule.pattern, 'u').test(value)) return false;
  if (Array.isArray(value)) return !(rule.minItems !== undefined && value.length < rule.minItems || rule.maxItems !== undefined && value.length > rule.maxItems)
    && value.every(item => withinPipelineSchema(item, rule.items));
  if (value && typeof value === 'object' && rule.properties)
    return Object.entries(rule.properties).every(([key, child]) => withinPipelineSchema((value as Record<string, unknown>)[key], child));
  return true;
}
export function validPipelineOutput(key: PipelineStepKey, value: unknown, schema?: object, paragraphBudget?: number, headings = true) {
  if (!(key === 'material' || outputs[key].safeParse(value).success) || !withinPipelineSchema(value, schema)) return false;
  if ((key === 'intro' || key === 'section') && paragraphBudget !== undefined) {
    const paragraphs = (value as { paragraphs: { text: string }[] }).paragraphs;
    if (paragraphs.reduce((sum,p) => sum+countCharacters(p.text),0) > paragraphBudget) return false;
  }
  if (key === 'article' && exceedsArticleBudget(value,paragraphBudget,headings)) return false;
  return true;
}
/** Check the whole written body before storing a reusable single-call checkpoint. */
export function exceedsArticleBudget(value: unknown,budget?: number,headings = true) {
  if (budget === undefined) return false;
  const result = outputs.article.safeParse(value);
  if (!result.success) return false;
  const article = result.data;
  const count = textStats(writtenArticleText(article, headings)).characters;
  return count > budget;
}
/** Bounded diagnostics identify sizing failures without retaining model text. */
export function exceedsParagraphBudget(key: PipelineStepKey,value: unknown,budget?: number) {
  if ((key !== 'intro' && key !== 'section') || budget === undefined || !value || typeof value !== 'object') return false;
  const paragraphs = (value as { paragraphs?: unknown }).paragraphs;
  return Array.isArray(paragraphs) && paragraphs.every(p => p && typeof p.text === 'string')
    && paragraphs.reduce((sum,p) => sum+countCharacters(p.text),0) > budget;
}

type WrittenArticle = { intro: { text: string; evidenceIds: string[] }[]; sections: { title: string; paragraphs: { text: string; evidenceIds: string[] }[] }[] };
export function writtenArticleText(article: WrittenArticle, headings: boolean) {
  return [...article.intro.map(p => p.text), ...article.sections.flatMap(section => [
    ...(headings ? [section.title] : []), ...section.paragraphs.map(p => p.text),
  ])].join('\n\n');
}
/** Run on fresh responses AND old checkpoints: an invalid result is never reusable. */
export function writingContractIssue(key: PipelineStepKey, value: unknown, contract?: WritingContract, headings = true) {
  if (!contract || !['article', 'intro', 'section'].includes(key)) return undefined;
  const result = outputs[key as 'article' | 'intro' | 'section'].safeParse(value);
  if (!result.success) return 'INVALID_PROVIDER_OUTPUT';
  if (key === 'article') {
    const article = result.data as WrittenArticle;
    return articleLengthIssue(textStats(writtenArticleText(article, headings)), contract.limits ?? {})
      ?? articleQuotationIssue([...article.intro, ...article.sections.flatMap(section => section.paragraphs)], contract.evidence, contract.minQuotes);
  }
  const part = result.data as { paragraphs: { text: string; evidenceIds: string[] }[] };
  return articleQuotationIssue(part.paragraphs, contract.evidence);
}
