import 'server-only';
import { PIPELINE_SCHEMAS } from '../domain/pipeline.ts';
import type { PipelineStepKey } from '../domain/pipeline.ts';

/** Constrain a podcast's actual structure in the provider grammar, not only after caching. */
export function outlineResponseSchema(sections: number,ids: readonly string[],dek = false) {
  const schema = structuredClone(PIPELINE_SCHEMAS.outline);
  // Event formats plan the linha fina with the title; the article's contract stays unchanged.
  if (dek) {
    schema.properties = { title: schema.properties.title,dek: { type: 'string',minLength: 1,maxLength: 180 },...schema.properties };
    schema.required = Object.keys(schema.properties);
  }
  const body = schema.properties.sections as { minItems: number; maxItems: number; items: { properties: { evidenceIds: { items: object } } } };
  body.minItems = body.maxItems = sections;
  // Large podcasts can exceed vendor enum ceilings; local validation always checks every id.
  if (ids.length <= 400) {
    body.items.properties.evidenceIds.items = { type: 'string',enum: [...ids] };
    (schema.properties.introIds as { items: object }).items = { type: 'string',enum: [...ids] };
  }
  return schema;
}
/**
 * A model that opens with a fact tends to pick its id again for the section on the same subject. The
 * opening keeps that id and each section drops the opening's ids, as long as one of its own remains.
 * A section that would be left empty, and any other repeat (inside a part or between sections), stay
 * as they came for `editorialResponseValid` to reject. An answer without that overlap is returned as is.
 */
export function withoutOpeningRepeats(key: PipelineStepKey,value: unknown): unknown {
  if (key !== 'outline' && key !== 'quotes' || !value || typeof value !== 'object') return value;
  const output = value as { introIds?: unknown; sections?: unknown; sectionIds?: unknown };
  if (!Array.isArray(output.introIds) || !output.introIds.length) return value;
  const opening = new Set<unknown>(output.introIds);
  const own = (ids: unknown) => {
    if (!Array.isArray(ids)) return ids;
    const kept = ids.filter(id => !opening.has(id));
    return kept.length && kept.length < ids.length ? kept : ids;
  };
  const parts: unknown = key === 'quotes' ? output.sectionIds : output.sections;
  if (!Array.isArray(parts)) return value;
  const trimmed = parts.map(part => {
    if (key === 'quotes') return own(part);
    if (!part || typeof part !== 'object') return part;
    const ids = (part as { evidenceIds?: unknown }).evidenceIds, kept = own(ids);
    return kept === ids ? part : { ...part,evidenceIds: kept };
  });
  if (trimmed.every((part,index) => part === parts[index])) return value;
  return key === 'quotes' ? { ...output,sectionIds: trimmed } : { ...output,sections: trimmed };
}
/** Unknown/duplicate references and wrong section counts never become reusable checkpoints. */
export function editorialResponseValid(key: PipelineStepKey,value: unknown,known: ReadonlySet<string>,sections: number,expected?: { title: string; sections?: { title: string }[] }) {
  if (!['outline','quotes','intro','section','article'].includes(key)) return true;
  if (!value || typeof value !== 'object') return false;
  const output = value as { title?: string; introIds?: string[]; sectionIds?: string[][]; sections?: { title?: string; evidenceIds?: string[]; paragraphs?: { evidenceIds: string[] }[] }[]; intro?: { evidenceIds: string[] }[]; paragraphs?: { evidenceIds: string[] }[] };
  if (expected && output.title !== expected.title) return false;
  if (expected?.sections && (output.sections?.length !== expected.sections.length || output.sections.some((section,index) => section.title !== expected.sections![index].title))) return false;
  const ids = key === 'outline' ? [...(output.introIds ?? []),...(output.sections ?? []).flatMap(section => section.evidenceIds ?? [])]
    : key === 'quotes' ? [...(output.introIds ?? []),...(output.sectionIds ?? []).flat()]
    : [...(output.intro ?? []),...(output.paragraphs ?? []),...(output.sections ?? []).flatMap(section => section.paragraphs ?? [])].flatMap(paragraph => paragraph.evidenceIds);
  if (ids.some(id => !known.has(id))) return false;
  if (key === 'outline' && output.sections?.length !== sections || key === 'quotes' && output.sectionIds?.length !== sections) return false;
  return !['outline','quotes'].includes(key) || new Set(ids).size === ids.length;
}
