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
