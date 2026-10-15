import 'server-only';
import { z } from 'zod';
import { contentHash } from '../domain/text/hash.ts';
import { PIPELINE_SCHEMAS, renderPipelinePrompt } from '../domain/pipeline.ts';
import type { PipelineRevision, PipelineStepKey, PipelineVariables, PipelineCall } from '../domain/pipeline.ts';
import { cacheRead, cacheWrite } from './storage';
import { generateStructured } from './groq';
import { FlowError, safeCode } from './errors';
import { validPipelineOutput, exceedsParagraphBudget, exceedsArticleBudget, writingContractIssue, writtenArticleText } from './pipeline-output';
import type { WritingContract } from './pipeline-output';
import { countCharacters, textStats } from '../domain/text/stats.ts';
import { articleLengthIssue } from '../domain/article-policy.ts';

const paragraph = z.object({ text: z.string().trim().min(1).max(5000),evidenceIds: z.array(z.string()).min(1).max(30) }).strict();
type Outline = { title: string; sections: { title: string; evidenceIds: string[] }[] };
type WritingSize = { sections: readonly { budgetChars?: number }[]; introChars?: number; targetChars?: number; minChars?: number; maxChars?: number; minWords?: number; maxWords?: number; targetWords?: number; headings?: boolean };

/** Allocate the actual pauta budget; headings consume body characters too. */
export function articleWritingBudgets(outline: Outline, sizing: WritingSize) {
  const headingChars = sizing.headings ? outline.sections.reduce((sum, section) => sum + countCharacters(section.title), 0) : 0;
  const total = (sizing.introChars ?? 0) + sizing.sections.reduce((sum, section) => sum + (section.budgetChars ?? 0), 0);
  const bodyTarget = sizing.targetChars ?? sizing.maxChars;
  const scale = bodyTarget && total ? Math.min(1, Math.max(1, bodyTarget - headingChars) / total) : 1;
  const budget = (chars?: number) => chars === undefined ? undefined : Math.max(1, Math.floor(chars * scale));
  return { intro: budget(sizing.introChars), sections: outline.sections.map((_section, index) => budget(sizing.sections[index]?.budgetChars)) };
}
function budgetParagraphs(schema: object, budget?: number) {
  if (budget === undefined) return structuredClone(schema);
  const paragraphs = structuredClone(schema) as { maxItems: number; items: { properties: { text: { maxLength: number } } } };
  // Several complete paragraphs are allowed. The sum is checked locally;
  // a one-paragraph grammar made normal podcast articles undersized.
  // Keep the generous transport limit. A tight grammar can force the provider to
  // end a word/phrase just to satisfy maxLength; the actual budget is validated
  // locally on the complete response, before caching or publication.
  return paragraphs;
}
export function articlePartSchema(key: 'intro' | 'section', budget?: number) {
  const schema = structuredClone(PIPELINE_SCHEMAS[key]);
  schema.properties.paragraphs = budgetParagraphs(schema.properties.paragraphs as object, budget);
  return schema;
}
export function completeArticleSchema(outline: Outline, sizing: WritingSize) {
  const budget = articleWritingBudgets(outline, sizing), schema = structuredClone(PIPELINE_SCHEMAS.article);
  Object.assign(schema.properties.title as object,{ enum: [outline.title] });
  schema.properties.intro = budgetParagraphs(schema.properties.intro as object, budget.intro);
  const sections = schema.properties.sections as { minItems: number; maxItems: number; items: { properties: { title: object; paragraphs: object } } };
  sections.minItems = sections.maxItems = outline.sections.length;
  Object.assign(sections.items.properties.title,{ enum: outline.sections.map(section => section.title) });
  sections.items.properties.paragraphs = budgetParagraphs(sections.items.properties.paragraphs,
    budget.sections.every(value => value !== undefined) ? Math.min(...budget.sections as number[]) : undefined);
  return schema;
}

/** One bounded refinement toward the upper target, using measured data in the SAVED template. */
export async function writeCompleteArticle(outline: Outline, variables: PipelineVariables, sizing: WritingSize,
  call: (key: PipelineStepKey, schema: object, variables: PipelineVariables, index?: number) => Promise<unknown>) {
  const schema = completeArticleSchema(outline, sizing);
  const first = await call('article', schema, variables, 0);
  const shape = first as Parameters<typeof writtenArticleText>[0];
  const stats = textStats(writtenArticleText(shape, sizing.headings ?? true));
  const issue = articleLengthIssue(stats,sizing);
  if (!issue && (!sizing.targetChars || stats.characters >= sizing.targetChars * 0.93)) return first;
  // This is data interpolation, not an additional hidden editorial prompt. The
  // active article template explains how to use it; the same hard rules still hold.
  try { return await call('article', schema, { ...variables, sizing: JSON.stringify({ ...sizing, revisionFeedback: {
    actualCharacters: stats.characters, actualWords: stats.words, preferredMinimumChars: Math.ceil((sizing.targetChars ?? sizing.maxChars ?? stats.characters) * 0.93),
    ...(issue ? { violation: issue } : {}),
    previousDraft: first,
  } }) }, 1); }
  catch (error) {
    // An optional attempt toward the upper target cannot destroy an already valid draft.
    // A first draft below/above a hard limit is NEVER a fallback. Lease/cancel/refusal errors propagate.
    const recoverable = error instanceof FlowError && (/^ARTICLE_(?:SIZE|WORDS)_/.test(error.code)
      || ['ARTICLE_QUOTES_REQUIRED','UNSUPPORTED_ARTICLE_QUOTE','UNKNOWN_EVIDENCE','INVALID_PROVIDER_OUTPUT'].includes(error.code)
      || /^(?:OPENAI|GROQ|ANTHROPIC)_(?:RATE_LIMIT|QUOTA_EXHAUSTED|UNAVAILABLE|REQUEST_FAILED|OUTPUT_RETRY|INVALID_RESPONSE)$/.test(error.code));
    if (!issue && recoverable) return first;
    throw error;
  }
}

/** Every section receives the actual preceding output, never a guessed continuation. */
export async function writeSequentialArticle(outline: Outline,variables: PipelineVariables,
  sizing: WritingSize,
  call: (key: PipelineStepKey,schema: object,variables: PipelineVariables,index?: number) => Promise<unknown>) {
  const budgets = articleWritingBudgets(outline, sizing);
  const introSchema = articlePartSchema('intro', budgets.intro);
  const outputParagraphs = (schema: ReturnType<typeof articlePartSchema>, budget?: number) => {
    const contract = schema.properties.paragraphs as { maxItems: number; items: { properties: { text: { maxLength: number } } } };
    const total = budget ?? contract.items.properties.text.maxLength;
    const preferredCount = 2;
    const targetCharsEach = Math.floor(total * 0.98 / preferredCount);
    return { maxCount: contract.maxItems, preferredCount, maxCharsEach: total, maxTotalChars: total,
      targetCharsEach, targetWordsEach: Math.max(1, Math.floor(targetCharsEach / 5.6)) };
  };
  const part=async(key:'intro'|'section',schema:object,values:PipelineVariables,budget?:number,index?:number)=>{
    let value=await call(key,schema,values,index);
    if(exceedsParagraphBudget(key,value,budget)){
      const paragraphs=(value as {paragraphs:{text:string}[]}).paragraphs;
      // Reuse the saved template with measured feedback. Never clip sentences,
      // replace the operator's prompt, or restart already validated sections.
      value=await call(key,schema,{...values,sizing:JSON.stringify({...JSON.parse(values.sizing),revisionFeedback:{
        scope:'current_part',violation:'ARTICLE_PART_SIZE_EXCEEDED',
        actualCharacters:paragraphs.reduce((sum,p)=>sum+countCharacters(p.text),0),
        maxTotalChars:budget,targetTotalChars:Math.floor(budget!*0.98),previousDraft:value,
      }})},index);
    }
    if(exceedsParagraphBudget(key,value,budget))throw new FlowError('ARTICLE_PART_SIZE_EXCEEDED',502,true,5);
    return value;
  };
  const intro = z.object({ paragraphs: z.array(paragraph).min(1).max(3) }).strict().parse(await part('intro',introSchema,
    { ...variables,sizing: JSON.stringify({ ...sizing,introChars: budgets.intro,outputParagraphs: outputParagraphs(introSchema,budgets.intro) }) },budgets.intro));
  const sections: { title: string; paragraphs: z.infer<typeof paragraph>[] }[] = [];
  for (const [index,section] of outline.sections.entries()) {
    const history = [...intro.paragraphs.map(p => p.text),...sections.flatMap(s => [s.title,...s.paragraphs.map(p => p.text)])].join('\n\n');
    const schema = articlePartSchema('section', budgets.sections[index]);
    Object.assign(schema.properties.title as object,{ enum: [section.title] });
    const drafted = z.object({ title: z.string().min(1).max(120),paragraphs: z.array(paragraph).min(1).max(10) }).strict().parse(
      await part('section',schema,{ ...variables,history,section: JSON.stringify({ ...section,index,last: index === outline.sections.length-1 }),
        futureSections: JSON.stringify(outline.sections.slice(index+1)),sizing: JSON.stringify({ ...sizing,currentSection: { ...sizing.sections[index],budgetChars: budgets.sections[index] },
          outputParagraphs: outputParagraphs(schema,budgets.sections[index]),charactersAlreadyWritten: countCharacters(history) }) },budgets.sections[index],index));
    if (drafted.title !== section.title) throw new FlowError('OUTLINE_NOT_FOLLOWED',502);
    sections.push(drafted);
  }
  return { title: outline.title,intro: intro.paragraphs,sections };
}

/** The messages sent are exactly the saved system message and rendered stage template. */
export async function executePipelineStep(input: {
  pipeline: PipelineRevision; key: PipelineStepKey; index?: number; variables: PipelineVariables; schema: object;
  directory: string; previousDirectory?: string; factsDirectory?: string; signal: AbortSignal; trace: (call: PipelineCall) => Promise<void>;
  onText?: (text: string) => Promise<void>;
  writingContract?: WritingContract;
  validateOutput?: (value: unknown) => boolean;
  /** Hand measured length mismatches to a bounded revision; never cache them. */
  deferLengthRevision?: boolean;
}) {
  const step = input.pipeline.definition.steps[input.key];
  if (!step) throw new FlowError('PIPELINE_STAGE_MISSING',503);
  const systemPrompt = input.pipeline.definition.systemPrompt;
  const userPrompt = renderPipelinePrompt(step.prompt,input.variables);
  // Unrelated prompt edits must not force the same podcast facts through the
  // provider again. Identity is the exact request, not the whole revision.
  const hash = contentHash({ key: input.key,index: input.index,systemPrompt,userPrompt,
    schema: input.schema,model: step.model,temperature: step.temperature,maxTokens: step.maxTokens,
    ...(['article', 'intro', 'section'].includes(input.key) ? { validation: 'r1-length-and-literal-quotes-v1' }
      : input.key === 'assist' ? { validation: 'article-assist-scope-quotes-and-size-v1' } : {}) });
  const cacheKey = 'pipeline-'+hash;
  const sizing = JSON.parse(input.variables.sizing || '{}');
  const budget = input.key === 'intro' ? sizing.introChars : input.key === 'section' ? sizing.currentSection?.budgetChars
    : input.key === 'article' ? sizing.maxChars : undefined;
  const valid = (value: unknown) => validPipelineOutput(input.key,value,input.schema,budget,sizing.headings)
    && !writingContractIssue(input.key, value, input.writingContract, sizing.headings)
    && (input.validateOutput?.(value) ?? true);
  const startedAt = new Date().toISOString();
  const base: PipelineCall = { key: input.key,...(input.index === undefined ? {} : { index: input.index }),hash,model: step.model,status: 'running',startedAt };
  await input.trace(base);
  try {
  let result = await cacheRead<Awaited<ReturnType<typeof generateStructured>>>(input.directory,cacheKey);
  // A legacy invalid checkpoint must not make every retry fail in the same way.
  if (result && !valid(result.value)) result = null;
  if (!result && input.previousDirectory) {
    const previous = await cacheRead<Awaited<ReturnType<typeof generateStructured>>>(input.previousDirectory,cacheKey);
    if (previous && valid(previous.value)) {
      result = previous;
      await cacheWrite(input.directory,cacheKey,result);
    }
  }
  if (!result && input.key === 'facts' && input.factsDirectory) {
    const previous = await cacheRead<Awaited<ReturnType<typeof generateStructured>>>(input.factsDirectory,cacheKey);
    if (previous && valid(previous.value)) {
      result = previous;
      await cacheWrite(input.directory,cacheKey,result);
    }
  }
  const cached = Boolean(result);
  let needsRevision = false;
  if (!result) {
    result = await generateStructured('', '',input.schema,input.signal,{ ...step,systemPrompt,userPrompt,...(input.onText ? { onText: input.onText } : {}) });
    if (!valid(result.value)) {
      needsRevision = Boolean(input.deferLengthRevision && (input.key === 'article'||exceedsParagraphBudget(input.key,result.value,budget))
        && validPipelineOutput(input.key,result.value,input.schema,undefined,sizing.headings)
        && !writingContractIssue(input.key,result.value,input.writingContract ? { ...input.writingContract,limits: {} } : undefined,sizing.headings)
        && (input.validateOutput?.(result.value) ?? true));
      if (!needsRevision) throw new FlowError(writingContractIssue(input.key, result.value, input.writingContract, sizing.headings)
      ?? (exceedsParagraphBudget(input.key,result.value,budget)
      ? 'ARTICLE_PART_SIZE_EXCEEDED' : input.key === 'article' && exceedsArticleBudget(result.value,budget,sizing.headings)
        ? 'ARTICLE_SIZE_EXCEEDED' : 'INVALID_PROVIDER_OUTPUT'),502,true,5);
    }
    if (!needsRevision) await cacheWrite(input.directory,cacheKey,result);
    if (input.key === 'facts' && input.factsDirectory) await cacheWrite(input.factsDirectory,cacheKey,result);
  }
  await input.trace({ ...base,status: 'completed',completedAt: new Date().toISOString(),requestId: result.provider_request_id,cached });
  // A reused response makes no new provider request: do not count its old tokens again.
  return cached ? { ...result,input_units: 0,output_units: 0,needsRevision: false } : { ...result,needsRevision };
  } catch (error) {
    try { await input.trace({ ...base,status: 'failed',completedAt: new Date().toISOString(),errorCode: safeCode(error) }); }
    catch { /* Lost/cancelled leases cannot write a late trace. */ }
    throw error;
  }
}

/** Dense summary passes need more headroom than raw transcript passages. */
export function editorialPassageSize(round: number) { return round === 0 ? 6000 : 3000; }
