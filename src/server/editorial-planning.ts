import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PIPELINE_SCHEMAS } from '../domain/pipeline.ts';
import { defaultEditorialPlan } from '../domain/editorial-plan.ts';
import type { PipelineVariables } from '../domain/pipeline.ts';
import { parseTranscript } from '../domain/text/transcript-parse.ts';
import { editorialTransaction } from './editorial';
import { activePipeline } from './pipeline';
import { executePipelineStep } from './pipeline-runner';
import { workDirectory, sourcePreparationDirectory } from './storage';
import { logEvent } from './errors';
/** Suggest independent pautas using the same visible facts/outline stages as writing. */
export async function planEditorialMaterial(text: string, question: string, signal: AbortSignal) {
  const pipeline = (await editorialTransaction('runtime', async checkpoint => structuredClone(activePipeline(checkpoint)), false)).value;
  const segments = parseTranscript(text).segments;
  const directory = await workDirectory(randomUUID()), factsDirectory = await sourcePreparationDirectory();
  const variables: PipelineVariables = { source: '', brief: JSON.stringify({ editorial: { ...defaultEditorialPlan(),
    instructions: `Mapeie pautas independentes, facetas e eventos das fontes. Sugira apenas temas sustentados, sem quantidade fixa ou canibalização. Os intertítulos desta resposta representam sugestões de pautas, não artigos já encomendados. Pedido do editor: ${question}`.slice(0, 6000) } }),
    sizing: JSON.stringify({ purpose: 'topic_map', maxSections: 20 }), outline: '', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' };
  const source = segments.map(segment => `[${segment.id}] ${segment.text}`).join('\n');
  const call = async (key: 'facts' | 'outline', index?: number) => executePipelineStep({ pipeline, key, index, variables, schema: PIPELINE_SCHEMAS[key], directory, factsDirectory, signal,
    trace: async call => logEvent('api', `editorial_planning_${call.status}`, { request_id: call.requestId ?? '' }) });
  if (source.length > 40000) {
    const summaries: string[] = [];
    for (let offset = 0; offset < source.length; offset += 20000) {
      variables.source = source.slice(offset, offset + 20000);
      const response = await call('facts', offset / 20000);
      const facts = z.object({ facts: z.array(z.string()).min(1).max(50) }).parse(response.value);
      summaries.push(facts.facts.join('\n'));
    }
    variables.source = summaries.join('\n\n');
  } else variables.source = source;
  const response = await call('outline');
  const result = z.object({ title: z.string(), sections: z.array(z.object({ title: z.string() })).min(1).max(20) }).parse(response.value);
  return { title: result.title, topics: [...new Set(result.sections.map(s => s.title))], pipelineRevision: pipeline.revision };
}
