import assert from 'node:assert/strict';
import { mock,test } from 'node:test';
import { bindWorkerJob,currentWorkerContext,logWorkerEvent,requireWorkerContext,runWithWorkerContext } from '../src/server/worker-context.ts';

const tenant='10000000-0000-0000-0000-000000000001',a='10000000-0000-0000-0000-000000000101',b='10000000-0000-0000-0000-000000000102';
const actor='10000000-0000-0000-0000-000000000031',other='10000000-0000-0000-0000-000000000032';

test('concurrent worker continuations keep independent ownership and cannot relabel a task',async()=>{
  const release=Promise.withResolvers<void>(),input={tenant,portal:a};
  const first=runWithWorkerContext(input,async()=>{
    bindWorkerJob(actor,'editorial',a);await release.promise;
    assert.equal(requireWorkerContext().portal,a);assert.equal(requireWorkerContext().actor,actor);
    assert.throws(()=>bindWorkerJob(other,'editorial',a),/WORKER_CONTEXT_CHANGED/);
    assert.throws(()=>bindWorkerJob(actor,'editorial',b),/WORKER_CONTEXT_CHANGED/);
  });
  await runWithWorkerContext({tenant,portal:b},async()=>{
    bindWorkerJob(other,'outbox',b);release.resolve();await first;
    assert.equal(requireWorkerContext().portal,b);assert.equal(requireWorkerContext().actor,other);
  });
  assert.deepEqual(input,{tenant,portal:a},'the supplied ownership object is never mutated');
  assert.equal(currentWorkerContext(),undefined);assert.throws(requireWorkerContext,/WORKER_CONTEXT_MISSING/);
});

test('worker logs derive client and actor from their execution and retain no source text or credential',()=>{
  const lines:string[]=[],spy=mock.method(process.stdout,'write',(chunk:unknown)=>{lines.push(String(chunk));return true;});
  try{
    runWithWorkerContext({tenant,portal:b,actor},()=>logWorkerEvent('worker','fixture_completed',{
      workspace_id:a,actor_id:other,generation_id:a,...{body:'Private article',secret:'Private credential'},
    }));
  }finally{spy.mock.restore();}
  const entry=JSON.parse(lines[0]);assert.equal(entry.workspace_id,b);assert.equal(entry.actor_id,actor);
  assert.equal(entry.generation_id,a);assert.equal(entry.body,undefined);assert.equal(entry.secret,undefined);
});
