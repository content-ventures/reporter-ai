import 'server-only';
import { z } from 'zod';
import { contentHash } from '../domain/text/hash.ts';
import { PIPELINE_SCHEMAS, renderPipelinePrompt } from '../domain/pipeline.ts';
import type { PipelineRevision, PipelineStepKey, PipelineVariables, PipelineCall } from '../domain/pipeline.ts';
import { cacheRead, cacheWrite } from './storage';
import { generateStructured } from './groq';
import { FlowError, safeCode } from './errors';
import { restoreLiteralQuoteCase, validPipelineOutput, exceedsParagraphBudget, exceedsArticleBudget, writingContractIssue, writtenArticleText } from './pipeline-output';
import type { WritingContract } from './pipeline-output';
import { countCharacters, countWords, textStats } from '../domain/text/stats.ts';
import { reintroducedPeople, repeatedSentences } from '../domain/grounding.ts';
import { articleLengthIssue, articleQuotationIssue, directQuotes, hasQuote, literalQuoteText, quoteKey, quotedWords, unquoteUnsupported } from '../domain/article-policy.ts';
import { articleSentences } from '../domain/text/sentences.ts';
import { QUOTABLE_MIN_WORDS, quoteRequirement } from '../domain/quote-plan.ts';
import type { QuotableCandidate, QuoteRule } from '../domain/quote-plan.ts';

export { articleSentences } from '../domain/text/sentences.ts';

const paragraph = z.object({ text: z.string().trim().min(1).max(5000),evidenceIds: z.array(z.string()).min(1).max(30) }).strict();
type Outline = { title: string; introIds?: string[]; sections: { title: string; evidenceIds: string[] }[] };
/** The quotations a part should carry (quote-plan.ts), sent in its sizing as `quotePlan`. */
type QuotePlan = { required: number; quotesStillNeeded: number; availableQuoteIds: string[] };
/** Soft revisions the active prompts explain: today, asking a part for the quote its evidence allows. */
export type SoftRevisions = { rule: QuoteRule; quotable: (ids: readonly string[]) => readonly QuotableCandidate[] };
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
type PartFloor = { chars: number; words: number };
/** Measured on staging with gpt-oss-120b: a paragraph runs 300 to 400 characters whatever its target. */
const PARAGRAPH_CHARS = 300, LONG_PARAGRAPH_CHARS = 400;
/** As many paragraphs as the target asks for and the ceiling holds, from one to the contract's limit. */
function paragraphCount(target: number, maximum: number, limit: number) {
  return Math.max(1, Math.min(limit, Math.round(target / PARAGRAPH_CHARS), Math.floor(maximum / LONG_PARAGRAPH_CHARS)));
}
/** Each part's share of the article minimums, in proportion to its budget. Intertítulos count as body. */
export function articlePartFloors(outline: Outline, sizing: WritingSize, budgets = articleWritingBudgets(outline, sizing)): PartFloor[] | undefined {
  const parts = [budgets.intro, ...budgets.sections];
  if (sizing.minChars === undefined && sizing.minWords === undefined || parts.some(budget => budget === undefined)) return undefined;
  const headings = sizing.headings ? outline.sections.map(section => section.title) : [];
  const body = { chars: Math.max(0, (sizing.minChars ?? 0) - headings.reduce((sum, title) => sum + countCharacters(title), 0)),
    words: Math.max(0, (sizing.minWords ?? 0) - headings.reduce((sum, title) => sum + countWords(title), 0)) };
  const total = parts.reduce<number>((sum, budget) => sum + budget!, 0);
  return parts.map(budget => ({ chars: Math.ceil(body.chars * budget! / total), words: Math.ceil(body.words * budget! / total) }));
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
  // Three paragraphs of one to three sentences reach a part's target without long, padded sentences;
  // two left the provider about two thirds short of it.
  (schema.properties.paragraphs as {maxItems:number}).maxItems=3;
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
  call: (key: PipelineStepKey,schema: object,variables: PipelineVariables,index?: number) => Promise<unknown>,
  evidence?:ReadonlyMap<string,string>,evidencePassages?:(ids:readonly string[])=>readonly string[],
  /** Event formats: the numbers and names of a text that the material, speakers and event lack. */
  grounding?:(text:string)=>string[],
  /** Event formats: the confirmed speakers' names, introduced once and then named by the surname. */
  people:readonly string[]=[],
  /** Given only when both writing prompts explain SECTION_QUOTE_REQUIRED; asked once per part, never fatal. */
  soft?:SoftRevisions) {
  const budgets = articleWritingBudgets(outline, sizing);
  const floors = articlePartFloors(outline, sizing, budgets);
  const introSchema = articlePartSchema('intro', budgets.intro);
  const outputParagraphs = (schema: ReturnType<typeof articlePartSchema>, budget?: number, maximum=budget) => {
    const contract = schema.properties.paragraphs as { maxItems: number; items: { properties: { text: { maxLength: number } } } };
    const total = budget ?? contract.items.properties.text.maxLength;
    const preferredCount = paragraphCount(total * 0.98, maximum ?? total, contract.maxItems);
    const targetCharsEach = Math.floor(total * 0.98 / preferredCount);
    return { maxCount: contract.maxItems, preferredCount, maxCharsEach: maximum??total, maxTotalChars: maximum??total,
      targetCharsEach, targetWordsEach: Math.max(1, Math.floor(targetCharsEach / 6.5)) };
  };
  const partSizing=(budget:number|undefined,extra:object,maximum=budget)=>({
    scope:'current_part',maxChars:maximum,targetChars:budget===undefined?undefined:Math.floor(budget*0.98),
    targetWords:budget===undefined?undefined:Math.floor(budget*0.98/6.5),
    articleLimits:{minChars:sizing.minChars,maxChars:sizing.maxChars,minWords:sizing.minWords,maxWords:sizing.maxWords,
      targetChars:sizing.targetChars,targetWords:sizing.targetWords,minQuotes:(sizing as WritingSize&{minQuotes?:number}).minQuotes},
    headings:sizing.headings,...extra,
  });
  const measured=(paragraphs:readonly {text:string}[])=>({chars:paragraphs.reduce((sum,p)=>sum+countCharacters(p.text),0),
    words:paragraphs.reduce((sum,p)=>sum+countWords(p.text),0)});
  const minimums=(floor?:PartFloor)=>floor?{minChars:floor.chars,minWords:floor.words}:{};
  // Each part's quotable lines (identified speaker, 4+ words, no question) and the quotations already written.
  const quotable=soft?[outline.introIds??[],...outline.sections.map(section=>section.evidenceIds)].map(ids=>soft.quotable(ids)):[];
  const quotedIn=(text:string)=>new Set(directQuotes(text).filter(quote=>countWords(quote)>=QUOTABLE_MIN_WORDS).map(quoteKey)).size;
  const quotePlan=(index:number,history:string):QuotePlan|undefined=>{
    if(!soft)return undefined;
    const quoted=quotedIn(history);
    return {required:quoteRequirement({rule:soft.rule,quoted,available:quotable.map(list=>list.length),index}),
      quotesStillNeeded:Math.max(0,soft.rule.minQuotes-quoted),availableQuoteIds:quotable[index].map(candidate=>candidate.key)};
  };
  const planned=(plan?:QuotePlan)=>plan?{quotePlan:plan}:{};
  const part=async(key:'intro'|'section',schema:object,values:PipelineVariables,budget?:number,index?:number,floor?:PartFloor,plan?:QuotePlan)=>{
    const paragraphsOf=(value:unknown)=>(value as {paragraphs:{text:string;evidenceIds:string[]}[]}).paragraphs;
    const ungrounded=(value:unknown)=>grounding?[...new Set(paragraphsOf(value).flatMap(p=>grounding(p.text)))]:[];
    // Event formats: a quotation is used once in the whole text (outlet style), never twice.
    const written=literalQuoteText(values.history??'');
    const repeated=(value:unknown)=>{
      if(!grounding)return [];
      // A quotation reused with another first capital is the same quotation.
      const seen=new Set<string>(),again:string[]=[];
      for(const quote of paragraphsOf(value).flatMap(p=>directQuotes(p.text)).map(literalQuoteText)){
        if(seen.has(quoteKey(quote))||hasQuote(written,quote))again.push(quote);
        seen.add(quoteKey(quote));
      }
      return again;
    };
    const partText=(value:unknown)=>paragraphsOf(value).map(p=>p.text).join('\n');
    const restated=(value:unknown)=>grounding?repeatedSentences(partText(value),values.history??''):[];
    const reintroduced=(value:unknown)=>grounding?reintroducedPeople(partText(value),values.history??'',people):[];
    const hard=(value:unknown)=>exceedsParagraphBudget(key,value,budget)?'ARTICLE_PART_SIZE_EXCEEDED'
      :(evidence?articleQuotationIssue(paragraphsOf(value),evidence,0,evidencePassages):undefined)
        ??(ungrounded(value).length?'UNGROUNDED_FACT':repeated(value).length?'REPEATED_QUOTE'
          :restated(value).length?'REPEATED_FACT':reintroduced(value).length?'REINTRODUCED_PERSON':undefined);
    const short=(value:unknown)=>{if(!floor)return false;const size=measured(paragraphsOf(value));return size.chars<floor.chars||size.words<floor.words;};
    // A part asked for a quotation meets it with that many new quotations of four words or more.
    const required=plan?.required??0;
    const partQuotes=(value:unknown)=>new Set(paragraphsOf(value).flatMap(p=>directQuotes(p.text))
      .filter(quote=>countWords(quote)>=QUOTABLE_MIN_WORDS&&!hasQuote(written,quote)).map(quoteKey)).size;
    const meets=(value:unknown)=>required===0||partQuotes(value)>=required;
    const better=(value:unknown,than:unknown)=>meets(value)!==meets(than)?meets(value)
      :measured(paragraphsOf(value)).words>measured(paragraphsOf(than)).words;
    const availableQuotes=()=>(quotable[key==='intro'?0:(index??0)+1]??[])
      .filter(candidate=>!hasQuote(written,quotedWords(literalQuoteText(candidate.text)))).slice(0,6)
      .map(candidate=>({id:candidate.key,text:candidate.text.slice(0,400),...(candidate.speaker?{speaker:candidate.speaker}:{})}));
    const repair=(draft:unknown)=>{
      let paragraphs=paragraphsOf(draft).map(p=>({...p}));
      if(evidence)paragraphs=unquoteUnsupported(paragraphs,evidence,evidencePassages);
      // An invented number or name is never kept, nor a quotation used twice: the sentence goes, nothing is rewritten.
      if(grounding){
        const used=new Set<string>();
        paragraphs=paragraphs.flatMap(p=>{
          const kept=articleSentences(p.text).filter(sentence=>{
            const quotes=directQuotes(sentence).map(literalQuoteText);
            if(grounding(sentence).length||quotes.some(quote=>used.has(quoteKey(quote))||hasQuote(written,quote))
              ||repeatedSentences(sentence,values.history??'').length)return false;
            quotes.forEach(quote=>used.add(quoteKey(quote)));
            return true;
          });
          // A person already introduced is named by the surname from here on.
          const text=kept.join(' ');
          const named=reintroducedPeople(text,values.history??'',people)
            .reduce((result,name)=>result.split(name).join(name.trim().split(/\s+/).pop()!),text);
          return kept.length?[{...p,text:named}]:[];
        });
      }
      if(!paragraphs.length)throw new FlowError('UNGROUNDED_FACT',502);
      if(budget!==undefined&&soft){
        // Sentences without a quotation go first, from the end; the part's last quotation stays while one is required.
        const units=paragraphs.flatMap((p,at)=>articleSentences(p.text).map(sentence=>({at,sentence,dropped:false,
          quoted:directQuotes(sentence).some(quote=>countWords(quote)>=QUOTABLE_MIN_WORDS)})));
        const rebuilt=()=>paragraphs.flatMap((p,at)=>{
          const text=units.filter(unit=>unit.at===at&&!unit.dropped).map(unit=>unit.sentence).join(' ');
          return text?[{...p,text}]:[];
        });
        while(measured(rebuilt()).chars>budget){
          const alive=units.filter(unit=>!unit.dropped),quotes=alive.filter(unit=>unit.quoted);
          const victim=[...alive].reverse().find(unit=>!unit.quoted)??(required>0&&quotes.length<=1?undefined:quotes.at(-1));
          if(alive.length<=1||!victim)break;
          victim.dropped=true;
        }
        paragraphs=rebuilt();
      }else if(budget!==undefined){
        while(paragraphs.length>1&&measured(paragraphs).chars>budget)paragraphs=paragraphs.slice(0,-1);
        if(measured(paragraphs).chars>budget){
          const sentences=articleSentences(paragraphs[0].text);
          while(sentences.length>1&&countCharacters(sentences.join(' '))>budget)sentences.pop();
          paragraphs[0]={...paragraphs[0],text:sentences.join(' ')};
        }
      }
      return {...(draft as object),paragraphs};
    };
    let value=await call(key,schema,values,index);
    let requested=values,developed=false,askedQuote=false;
    // A development that breaks the hard contract never replaces a valid, merely short draft.
    let kept=hard(value)?undefined:value;
    for(let revision=1;revision<=2;revision++){
      // One development per part: a part that stays short passes its shortfall to the next one.
      // The quotation is asked once, after the hard and size checks; a part that stays without it is kept.
      const violation:string|undefined=hard(value)??(!developed&&short(value)?'ARTICLE_PART_TOO_SHORT':undefined)
        ??(!askedQuote&&!meets(value)?'SECTION_QUOTE_REQUIRED':undefined);
      if(!violation)break;
      developed||=violation==='ARTICLE_PART_TOO_SHORT';
      askedQuote||=violation==='SECTION_QUOTE_REQUIRED';
      const paragraphs=paragraphsOf(value);
      const actual=textStats(paragraphs.map(p=>p.text).join(' '));
      const ratio=Math.max(1,actual.characters/Math.max(1,actual.words));
      const sizing=JSON.parse(requested.sizing);
      const previousTarget=sizing.targetChars??budget??actual.characters;
      const targetTotalChars=violation==='ARTICLE_PART_SIZE_EXCEEDED'
        ?Math.floor((budget??actual.characters)*0.95*Math.min(1,previousTarget/actual.characters))
        :violation==='ARTICLE_PART_TOO_SHORT'
          ?Math.min(Math.floor((budget??Infinity)*0.98),Math.max(previousTarget,floor!.chars,Math.ceil(floor!.words*ratio)))
          :Math.min(budget??actual.characters,previousTarget);
      const targetWords=Math.max(violation==='ARTICLE_PART_TOO_SHORT'?floor!.words:0,Math.floor(targetTotalChars/ratio));
      // Paragraph count drives the provider's length far more than character targets do.
      const fit=paragraphCount(targetTotalChars,budget??targetTotalChars,sizing.outputParagraphs.maxCount);
      const count=violation==='ARTICLE_PART_SIZE_EXCEEDED'?Math.min(fit,sizing.outputParagraphs.preferredCount):fit;
      // Revise only this part through the saved template, with measured feedback
      // and safer per-paragraph targets. Source and preceding prose stay unchanged.
      requested={...values,sizing:JSON.stringify({...sizing,targetChars:targetTotalChars,targetWords,
        // Saved templates also reference these targets. Leaving the original
        // allocation here contradicted the measured revision target above.
        ...(key==='intro'?{introChars:targetTotalChars}
          :{currentSection:{...sizing.currentSection,budgetChars:targetTotalChars}}),
        outputParagraphs:{...sizing.outputParagraphs,preferredCount:count,targetCharsEach:Math.floor(targetTotalChars/count),targetWordsEach:Math.max(1,Math.floor(targetWords/count))},
        revisionFeedback:{scope:'current_part',attempt:revision,maxAttempts:2,violation,actualCharacters:measured(paragraphs).chars,actualWords:actual.words,
          ...(violation==='UNGROUNDED_FACT'?{ungroundedTerms:ungrounded(value)}:{}),
          ...(violation==='REPEATED_QUOTE'?{repeatedQuotes:repeated(value)}:{}),
          ...(violation==='REPEATED_FACT'?{repeatedSentences:restated(value)}:{}),
          ...(violation==='REINTRODUCED_PERSON'?{reintroducedPeople:reintroduced(value)}:{}),
          ...(violation==='SECTION_QUOTE_REQUIRED'?{availableQuotes:availableQuotes()}:{}),
          ...(floor?{minTotalChars:floor.chars,minTotalWords:floor.words}:{}),maxTotalChars:budget,targetTotalChars,previousDraft:value},
      })};
      value=await call(key,schema,requested,index);
      if(!hard(value)&&(!kept||better(value,kept)))kept=value;
    }
    const unresolved=hard(value);
    if(unresolved&&!kept){
      // A provider that ignores two measured revisions must not fail the whole article. Keep the
      // words of an unsupported quotation as plain text, and drop whole trailing paragraphs, then
      // whole trailing sentences, that do not fit the ceiling. The final R1 check still decides.
      const repaired=repair(value);
      if(!hard(repaired))return repaired;
      throw new FlowError(unresolved,502);
    }
    return unresolved||short(value)||(!meets(value)&&kept!==undefined&&meets(kept))?kept:value;
  };
  // The article's ceiling bounds each part, not its share of the target: what is left of it after the
  // text already written and the minimums the later parts still need. A part's share was too tight.
  const room=sizing.maxChars===undefined?undefined
    :sizing.maxChars-(sizing.headings?outline.sections.reduce((sum,section)=>sum+countCharacters(section.title),0):0);
  const reserve=(from:number)=>[budgets.intro,...budgets.sections].slice(from).reduce<number>((sum,budget,offset)=>sum+(floors?floors[from+offset].chars:budget??0),0);
  const ceiling=(written:number,from:number,fallback?:number)=>room===undefined?fallback:Math.max(1,room-written-reserve(from));
  const introMaximum=ceiling(0,1,budgets.intro);
  const introPlan=quotePlan(0,'');
  const intro = z.object({ paragraphs: z.array(paragraph).min(1).max(3) }).strict().parse(await part('intro',introSchema,
    { ...variables,sizing: JSON.stringify(partSizing(budgets.intro,{introChars:budgets.intro,outputParagraphs:outputParagraphs(introSchema,budgets.intro,introMaximum),...minimums(floors?.[0]),...planned(introPlan)},introMaximum)) },
    introMaximum,undefined,floors?.[0],introPlan));
  const sections: { title: string; paragraphs: z.infer<typeof paragraph>[] }[] = [];
  const opening=measured(intro.paragraphs);
  let carry=Math.max(0,(introMaximum??0)-opening.chars),writtenChars=opening.chars;
  // How far the written parts are above (+) or below (−) their shares of the article minimums.
  let balance=floors?{chars:opening.chars-floors[0].chars,words:opening.words-floors[0].words}:{chars:0,words:0};
  for (const [index,section] of outline.sections.entries()) {
    const history = [...intro.paragraphs.map(p => p.text),...sections.flatMap(s => [s.title,...s.paragraphs.map(p => p.text)])].join('\n\n');
    const target=budgets.sections[index],maximum=target===undefined?undefined:ceiling(writtenChars,index+2,target+carry);
    // A shortfall raises this section's minimums and budget; spare room only raises its ceiling.
    const share=floors?.[index+1],floor=share&&{chars:Math.max(0,share.chars-balance.chars),words:Math.max(0,share.words-balance.words)};
    const goal=target===undefined?undefined:Math.min(maximum!,target+Math.max(0,-balance.chars,Math.ceil(-balance.words*6.5)));
    const schema = articlePartSchema('section', maximum);
    Object.assign(schema.properties.title as object,{ enum: [section.title] });
    const plan=quotePlan(index+1,history);
    const drafted = z.object({ title: z.string().min(1).max(120),paragraphs: z.array(paragraph).min(1).max(10) }).strict().parse(
      await part('section',schema,{ ...variables,history,section: JSON.stringify({ ...section,index,last: index === outline.sections.length-1 }),
        futureSections: JSON.stringify(outline.sections.slice(index+1)),sizing: JSON.stringify(partSizing(goal,{currentSection: { ...sizing.sections[index],budgetChars:goal,maxChars:maximum },
          outputParagraphs: outputParagraphs(schema,goal,maximum),charactersAlreadyWritten: countCharacters(history),...minimums(floor),...planned(plan) },maximum)) },maximum,index,floor,plan));
    if (drafted.title !== section.title) throw new FlowError('OUTLINE_NOT_FOLLOWED',502);
    const written=measured(drafted.paragraphs);
    carry=Math.max(0,(maximum??0)-written.chars);writtenChars+=written.chars;
    if(share)balance={chars:balance.chars+written.chars-share.chars,words:balance.words+written.words-share.words};
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
  /** Hand repairable writing failures to one bounded revision; never cache them. */
  deferWritingRevision?: boolean;
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
  const budget = input.key === 'intro' ? sizing.maxChars??sizing.introChars : input.key === 'section' ? sizing.currentSection?.maxChars??sizing.currentSection?.budgetChars
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
    if(input.writingContract)result.value=restoreLiteralQuoteCase(input.key,result.value,input.writingContract.evidence,input.writingContract.evidencePassages);
    if (!valid(result.value)) {
      const literalIssue=writingContractIssue(input.key,result.value,input.writingContract ? {...input.writingContract,limits:{}}:undefined,sizing.headings);
      const repairableQuote=['intro','section'].includes(input.key)&&literalIssue==='UNSUPPORTED_ARTICLE_QUOTE';
      needsRevision = Boolean(input.deferWritingRevision && (input.key === 'article'||exceedsParagraphBudget(input.key,result.value,budget)||repairableQuote)
        && validPipelineOutput(input.key,result.value,input.schema,undefined,sizing.headings)
        && (!literalIssue||repairableQuote) && (input.validateOutput?.(result.value) ?? true));
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
