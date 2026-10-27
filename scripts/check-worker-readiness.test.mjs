import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForWorkerReadiness } from './check-worker-readiness.mjs';

test('readiness waits through a newly deployed function route returning plain text',async()=>{
  const responses=[new Response('function not found',{status:404}),Response.json({ok:true})];
  await waitForWorkerReadiness('https://worker.invalid','private',{attempts:2,sleep:async()=>{},request:async()=>responses.shift()});
  assert.equal(responses.length,0);
});
test('readiness fails with the bounded media code after retries',async()=>{
  await assert.rejects(waitForWorkerReadiness('https://worker.invalid','private',{attempts:1,request:async()=>Response.json({ok:false,error:'MEDIA_TOOL_EXEC_EACCES'},{status:503})}),/MEDIA_TOOL_EXEC_EACCES/);
});

test('readiness requires the exact checked-out worker source, including a rollback ref',async()=>{
  const expected='b'.repeat(40),responses=[Response.json({ok:true,sourceCommit:'a'.repeat(40)}),Response.json({ok:true,sourceCommit:expected})];
  await waitForWorkerReadiness('https://worker.invalid','private',{expectedCommit:expected,attempts:2,sleep:async()=>{},request:async()=>responses.shift()});
  assert.equal(responses.length,0);
  await assert.rejects(waitForWorkerReadiness('https://worker.invalid','private',{expectedCommit:expected,attempts:1,request:async()=>Response.json({ok:true})}),/WORKER_SOURCE_MISMATCH/);
});

test('source mismatch diagnostics retain the refusal and never log arbitrary response values',async t=>{
  const messages=[];t.mock.method(console,'log',message=>messages.push(message));
  const expected='b'.repeat(40),actual='a'.repeat(40);
  for(const sourceCommit of [actual,undefined,'private-response-value']){
    await assert.rejects(waitForWorkerReadiness('https://worker.invalid','private-key',{
      expectedCommit:expected,attempts:1,request:async()=>Response.json({ok:true,sourceCommit}),
    }),/WORKER_SOURCE_MISMATCH/);
  }
  assert.ok(messages.includes(`Worker source expected=${expected} actual=${actual}`));
  assert.ok(messages.includes(`Worker source expected=${expected} actual=missing`));
  assert.ok(messages.includes(`Worker source expected=${expected} actual=invalid`));
  assert.doesNotMatch(messages.join('\n'),/private-response-value|private-key|worker\.invalid/);
});
