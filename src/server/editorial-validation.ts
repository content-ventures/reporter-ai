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
