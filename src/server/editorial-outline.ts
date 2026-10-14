import 'server-only';
import { z } from 'zod';
import type { SourceRef } from '../domain/refs.ts';
import { PIPELINE_SCHEMAS, type PipelineVariables } from '../domain/pipeline.ts';
import type { OutlineInput } from '../ports/generation.ts';
import { FlowError } from './errors';
import { editorialResponseValid, outlineResponseSchema } from './editorial-validation';

const proposalSchema = z.object({ title: z.string().min(1).max(500), introIds: z.array(z.string()).max(2),
  sections: z.array(z.object({ title: z.string().min(1).max(120), evidenceIds: z.array(z.string()).min(1).max(20) }).strict()).min(1).max(8) }).strict();

/** Automatic planning uses the same prompts and literal-evidence guards as a reviewed outline. */
export async function planEditorialOutline({ sections: count, candidates, variables, curateQuotes, call, normalize }: {
  sections: number;
  candidates: readonly { key: string; ref: SourceRef }[];
  variables: PipelineVariables;
  curateQuotes: boolean;
  call: (key: 'outline' | 'quotes', schema: object, variables: PipelineVariables) => Promise<unknown>;
  normalize: (outline: OutlineInput) => OutlineInput;
}): Promise<OutlineInput> {
  const byKey = new Map(candidates.map(candidate => [candidate.key, candidate.ref]));
  const known = new Set(byKey.keys());
  let proposal = proposalSchema.parse(await call('outline', outlineResponseSchema(count, [...known]), variables));
  if (!editorialResponseValid('outline', proposal, known, count)) throw new FlowError('INVALID_OUTLINE', 502);
  if (curateQuotes) {
    const selected = z.object({ introIds: z.array(z.string()).max(2), sectionIds: z.array(z.array(z.string()).min(1).max(20)) }).strict()
      .parse(await call('quotes', PIPELINE_SCHEMAS.quotes, { ...variables, outline: JSON.stringify(proposal) }));
    if (!editorialResponseValid('quotes', selected, known, count)) throw new FlowError('INVALID_QUOTE_SELECTION', 502);
    proposal = { ...proposal, introIds: selected.introIds,
      sections: proposal.sections.map((section, index) => ({ ...section, evidenceIds: selected.sectionIds[index] })) };
  }
  const refs = (ids: string[]) => ids.map(id => byKey.get(id)!);
  return normalize({ title: proposal.title, intro: { quotes: refs(proposal.introIds) },
    sections: proposal.sections.map(section => ({ title: section.title, quotes: refs(section.evidenceIds) })) });
}
