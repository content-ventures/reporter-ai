import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {paragraphBlock,type ArticleBody} from '../../src/domain/article.ts';
import type {ConnectedWorkspace,WorkspaceRefresh} from '../../src/ports/connected-workspace.ts';
import {applyWorkspaceDelta} from '../../src/runtime/editorial-sync.ts';
import {currentWorkerContext} from '../../src/server/worker-context.ts';
import {SCENARIO_SOURCE,startWorkspaceScenario,type ScenarioActor} from '../support/workspace-scenario.ts';

const BUDGET={readP95Ms:250,writeP95Ms:500,editors:20,reviewers:2,iterations:120,fairDispatchRounds:2};
async function main(){
const scenario=await startWorkspaceScenario({editors:BUDGET.editors});
const times:Array<{kind:'read'|'write';ms:number;bytes:number}>=[],failures:string[]=[],claims:Array<{workspace:string;run:string;actor:string}>=[];
const rawFetch=globalThis.fetch;
const seen=new Set<string>();
globalThis.fetch=async(input,init)=>{
  if(String(input).startsWith('https://api.groq.com/')){
    const context=currentWorkerContext()!,client=scenario.clients.find(client=>client.id===context.portal)!;
    assert.ok(client);const other=scenario.clients.find(candidate=>candidate!==client)!;
    const prompts=JSON.stringify(JSON.parse(String(init?.body)).messages);
    assert.ok(prompts.includes('Exclusive audience '+(client===scenario.clients[0]?'Alpha':'Beta')));
    assert.ok(prompts.includes('Exclusive voice '+(client===scenario.clients[0]?'Alpha':'Beta')));
    assert.ok(!prompts.includes('Exclusive voice '+(other===scenario.clients[0]?'Alpha':'Beta')));
    if(context.job&&!seen.has(context.job.id)){seen.add(context.job.id);claims.push({workspace:context.portal,run:context.job.id,actor:context.actor!});}
  }
  return rawFetch(input,init);
};
try{
  const editors=await Promise.all(scenario.editors.map(async(actor,index)=>{
    const client=scenario.clients[index<10?0:1];
    const created=await scenario.rpc<{productionId:string}>(actor,client.slug,'createBlank',{title:`${client.marker} editor ${index}`,brief:{size:'standard',sections:3}});
    const snapshot=(await scenario.call<ConnectedWorkspace>(actor,`/api/reporter/w/${client.slug}/workspace`)).value;
    return{actor,client,id:created.productionId,snapshot};
  }));
  type Editor=typeof editors[number];
  async function read(editor:Editor,measured:boolean){
    const before=performance.now(),result=await scenario.call<WorkspaceRefresh>(editor.actor,`/api/reporter/w/${editor.client.slug}/workspace?since=${encodeURIComponent(editor.snapshot.syncToken??'')}`);
    if(measured)times.push({kind:'read',ms:performance.now()-before,bytes:result.bytes});
    assert.equal(result.status,200,JSON.stringify(result.value));
    const other=scenario.clients.find(client=>client!==editor.client)!;
    assert.ok(!JSON.stringify(result.value).includes(other.marker),'a read must contain no other-client production content');
    editor.snapshot='unchanged'in result.value?{...editor.snapshot,syncToken:result.value.syncToken}:'delta'in result.value?{...applyWorkspaceDelta(editor.snapshot,{...result.value,seq:result.value.revision}).workspace,syncToken:result.value.syncToken}:result.value;
  }
  async function edit(editor:Editor,iterations:number,measured:boolean){
    try{
      for(let round=0;round<iterations;round++){
        await read(editor,measured);
        const piece=editor.snapshot.state.productions.find(item=>item.production.id===editor.id)!.pieces.find(piece=>piece.kind==='article')!;
        const body={...piece.draft.body as ArticleBody,title:`${editor.client.marker} revision ${round}`,blocks:Array.from({length:4},(_,index)=>paragraphBlock(`load-block-${index}`,`${editor.client.marker}: `+SCENARIO_SOURCE+` Revision ${round}.`))};
        const before=performance.now(),result=await scenario.call<{ok:boolean;refusal?:unknown}>(editor.actor,`/api/reporter/w/${editor.client.slug}/workspace`,{method:'saveDraft',args:[piece.id,body,piece.draft.revision],requestId:randomUUID()});
        if(measured)times.push({kind:'write',ms:performance.now()-before,bytes:result.bytes});
        assert.equal(result.status,200,JSON.stringify(result.value));assert.equal(result.value.ok,true,JSON.stringify(result.value));
        await delay(25);
      }
    }catch(error){failures.push(`${editor.actor.name}: ${error instanceof Error?error.message:String(error)}`);}
  }
  console.log('Warming 10 editors across both clients.');
  await Promise.all([...editors.slice(0,5),...editors.slice(10,15)].map(editor=>edit(editor,10,false)));assert.equal(failures.length,0,failures.join('\n'));
  const jobs:Array<{id:string;workspace:string;actor:string;hash:string}>=[];
  for(const[index,amount]of[[0,3],[1,2]])for(let number=0;number<amount;number++){
    const client=scenario.clients[index],actor=scenario.editors[index*10];
    const created=await scenario.rpc<{productionId:string;pieces:{kind:string;pieceId:string}[]}>(actor,client.slug,'createFromSource',{title:`${client.marker} queued ${number}`,brief:{size:'standard',sections:2},plan:['article'],material:{text:SCENARIO_SOURCE,origin:'podcast',authorized:true}});
    const article=created.pieces.find(piece=>piece.kind==='article')!;
    const started=await scenario.rpc<{runId:string}>(actor,client.slug,'generation.start','article.outline',{productionId:created.productionId,pieceId:article.pieceId});
    jobs.push({id:started.runId,workspace:client.id,actor:actor.id,hash:client.pipelineHash});
  }
  async function review(actor:ScenarioActor,index:number){
    for(let round=0;round<BUDGET.iterations;round++){
      const before=performance.now(),result=await scenario.call<ConnectedWorkspace>(actor,`/api/reporter/w/${scenario.clients[index].slug}/workspace`);
      times.push({kind:'read',ms:performance.now()-before,bytes:result.bytes});
      assert.equal(result.status,200);assert.ok(!JSON.stringify(result.value).includes(scenario.clients[index===0?1:0].marker));await delay(25);
    }
  }
  console.log(`Measuring ${BUDGET.editors} editors, ${BUDGET.reviewers} approvers and ${jobs.length} queued jobs.`);
  const begun=performance.now();
  const tasks=await Promise.allSettled([
    ...editors.map(editor=>edit(editor,BUDGET.iterations,true)),...scenario.reviewers.map(review),
    (async()=>{for(let turn=0;turn<5;turn++){await scenario.drain();const rows=await scenario.owner('SELECT status FROM public.reporter_ed_runs WHERE run_id=ANY($1::text[])',[jobs.map(job=>job.id)]);if(rows.every(row=>row.status==='completed'))return;}throw new Error('Queued jobs failed to complete');})(),
  ]);
  for(const task of tasks)if(task.status==='rejected')failures.push(String(task.reason));
  const elapsedMs=performance.now()-begun;assert.equal(failures.length,0,failures.join('\n'));
  for(const job of jobs){const[row]=await scenario.owner("SELECT portal_id,job->'context' AS context,job->>'pipelineHash' AS hash,fold FROM public.reporter_ed_runs WHERE run_id=$1",[job.id]);
    assert.equal(row.portal_id,job.workspace);assert.equal(row.context.workspace,job.workspace);assert.equal(row.context.actor,job.actor);assert.equal(row.hash,job.hash);assert.equal(row.fold.run.status,'completed');assert.ok(row.fold.run.usage.totalTokens>0);}
  assert.equal(claims.length,jobs.length);assert.ok(claims.findIndex(claim=>claim.workspace===scenario.clients[1].id)<BUDGET.fairDispatchRounds,'Beta must be claimed within two dispatch rounds while Alpha has a backlog');
  let denied=0;
  for(const editor of editors.slice(1)){const other=scenario.clients.find(client=>client!==editor.client)!;assert.equal((await scenario.call(editor.actor,`/api/reporter/w/${other.slug}/workspace`)).status,404);denied++;}
  assert.equal((await scenario.call(scenario.editors[0],`/api/reporter/w/${scenario.clients[1].slug}/workspace`)).status,200,'the shared account intentionally has an independent approver membership in Beta');
  const percentile=(kind:'read'|'write')=>{const values=times.filter(item=>item.kind===kind).map(item=>item.ms).sort((a,b)=>a-b);return values[Math.ceil(values.length*.95)-1];};
  const readP95Ms=percentile('read'),writeP95Ms=percentile('write');
  const report={budgets:BUDGET,elapsedMs,requests:times.length,failures:failures.length,reads:times.filter(item=>item.kind==='read').length,writes:times.filter(item=>item.kind==='write').length,
    readP95Ms,writeP95Ms,responseBytes:times.reduce((sum,item)=>sum+item.bytes,0),foreignRequestsRefused:denied,claims:claims.map(claim=>({client:claim.workspace===scenario.clients[0].id?'Alpha':'Beta',actorIsEnqueueOwner:jobs.find(job=>job.id===claim.run)?.actor===claim.actor})),
    providers:{synthetic:true,paidCalls:0,completions:scenario.providers.calls.completions},singleClientReference:{readP95Ms:60.2,writeP95Ms:98.6,note:'Historical context, not an equivalent same-build baseline or production SLA.'}};
  const path=process.env.REPORTER_WORKSPACE_LOAD_REPORT??'.reporter-local/multi-workspace/m8-load-report.json';await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  assert.ok(readP95Ms<BUDGET.readP95Ms,`Read p95 ${readP95Ms} ms exceeds ${BUDGET.readP95Ms} ms`);assert.ok(writeP95Ms<BUDGET.writeP95Ms,`Write p95 ${writeP95Ms} ms exceeds ${BUDGET.writeP95Ms} ms`);
}finally{globalThis.fetch=rawFetch;await scenario.stop();}

}
void main().catch(error=>{process.stderr.write(String(error instanceof Error?error.stack:error)+'\n');process.exitCode=1;});
