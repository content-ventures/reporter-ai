import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPipelineDefinition,pipelineRevision,PIPELINE_SCHEMAS } from '../src/domain/pipeline.ts';
import type { PipelineVariables,PipelineCall } from '../src/domain/pipeline.ts';
import { executePipelineStep,writeCompleteArticle } from '../src/server/pipeline-runner.ts';
import { cacheRead } from '../src/server/storage.ts';
import { FlowError } from '../src/server/errors.ts';
const vars: PipelineVariables = { source: 'Fonte sintética',brief: 'Pauta de teste',sizing: '{}',outline: '{}',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '', event: '', people: '' };
test('a first literal draft outside length can be measured for one revision but is NEVER cached', async () => {
  const a = 'A fonte confirma quatro fatos.',b = 'O episódio registra novos dados.';
  const value = { title: 'Teste',intro: [{ text: `“${a}”`,evidenceIds: ['a'] }],sections: [{ title: 'Fonte',paragraphs: [{ text: `“${b}”`,evidenceIds: ['b'] }] }] };
  const directory = await mkdtemp(join(tmpdir(),'reporter-bounded-revision-')),original = globalThis.fetch,traces: PipelineCall[] = [];
  process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop',message: { content: JSON.stringify(value) } }] });
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition()),key: 'article' as const,variables: vars,schema: PIPELINE_SCHEMAS.article,directory,
    signal: new AbortController().signal,trace: async (call: PipelineCall) => { traces.push(call); },writingContract: {
      limits: { minChars: 2500,maxChars: 4000,minWords: 500,maxWords: 800 },minQuotes: 2,evidence: new Map([['a',a],['b',b]]),
    } };
  try {
    const first = await executePipelineStep({ ...input,deferWritingRevision: true });
    assert.equal(first.needsRevision,true);
    assert.equal(await cacheRead(directory,'pipeline-'+traces.at(-1)!.hash),null);
    await assert.rejects(executePipelineStep(input),/ARTICLE_SIZE_TOO_SHORT/,'the final pass still has hard R1 limits');
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop',message: { content: JSON.stringify({ ...value,intro: [{ text: '“Uma fala completamente inventada.”',evidenceIds: ['a'] }] }) } }] });
    await assert.rejects(executePipelineStep({ ...input,deferWritingRevision: true }),/UNSUPPORTED_ARTICLE_QUOTE|ARTICLE_SIZE_TOO_SHORT/);
  } finally { globalThis.fetch = original;await rm(directory,{ recursive: true,force: true }); }
});
test('an oversized complete draft is revised once with real counts, never truncated or accepted', async () => {
  const sizing = { minChars: 2500,maxChars: 4000,minWords: 500,maxWords: 800,targetChars: 3900,sections: [{ budgetChars: 2900 }] };
  const outline = { title: 'Teste',sections: [{ title: 'Fonte',evidenceIds: ['a'] }] },requests: PipelineVariables[] = [];
  const draft = (count: number) => ({ title: 'Teste',intro: [{ text: 'fato '.repeat(count)+'.',evidenceIds: ['a'] }],sections: [{ title: 'Fonte',paragraphs: [{ text: 'Fato completo.',evidenceIds: ['a'] }] }] });
  await writeCompleteArticle(outline,vars,sizing,async (_key,_schema,variables) => { requests.push(variables);return draft(requests.length === 1 ? 900 : 760); });
  assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].sizing).revisionFeedback.violation,'ARTICLE_SIZE_EXCEEDED');
  assert.equal(requests[1].source,vars.source);
});
test('optional near-target refinement failure preserves a valid first article, never an invalid one', async () => {
  const sizing = { minChars: 2500,maxChars: 4000,minWords: 500,maxWords: 800,targetChars: 3900,sections: [{ budgetChars: 2900 }] };
  const outline = { title: 'Teste',sections: [{ title: 'Fonte',evidenceIds: ['a'] }] };
  const first = { title: 'Teste',intro: [{ text: 'fato '.repeat(700)+'.',evidenceIds: ['a'] }],sections: [{ title: 'Fonte',paragraphs: [{ text: 'Fato completo.',evidenceIds: ['a'] }] }] };
  let calls = 0;
  const result = await writeCompleteArticle(outline,vars,sizing,async () => { if (++calls > 1) throw new FlowError('ARTICLE_SIZE_EXCEEDED',502);return first; });
  assert.equal(result,first);assert.equal(calls,2);
  calls = 0;
  await assert.rejects(writeCompleteArticle(outline,vars,{ ...sizing,minChars: 3800 },async () => { if (++calls > 1) throw new FlowError('ARTICLE_SIZE_EXCEEDED',502);return first; }),/ARTICLE_SIZE_EXCEEDED/);
});
