import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
import { runWithReporterContext } from '../src/server/request-context.ts';
import { editorialRpc,editorialWorkspace,editorialPipeline } from '../src/server/editorial.ts';
import { prepareAssetUpload,completeAssetUpload } from '../src/server/image-assets.ts';
import { readImageFile } from '../src/server/image-storage.ts';
import { ATELIE_SUL_TRANSCRIPT } from '../src/fixtures/sources/atelie-sul.ts';
import { defaultPipelineDefinition } from '../src/domain/pipeline.ts';
import { markTextReviewed } from '../src/domain/article.ts';
import { latestApproved } from '../src/domain/record.ts';
import { createEditorialEngine } from '../src/runtime/editorial-engine.ts';
import { transaction } from '../src/server/database.ts';

if(!process.env.GITHUB_ACTIONS || !process.env.REPORTER_ACCEPTANCE_BRANCH?.startsWith('br-')) throw new Error('This acceptance writes only to an isolated workflow-created Neon branch.');
const portal='10000000-0000-0000-0000-000000000101',tenant='10000000-0000-0000-0000-000000000001';
const url=new URL(process.env.DATABASE_URL_UNPOOLED);url.searchParams.set('sslmode','verify-full');
const owner=new pg.Client({connectionString:url.toString()});await owner.connect();
const actors={};
try {
  for(const [name,roles] of [['editor',['editor']],['reviewer',['approver','creative_reviewer']]]){
    const actor=randomUUID(),email=`acceptance-${name}-${actor}@reporter.invalid`;
    await owner.query('INSERT INTO core.users(id,name,email) VALUES($1,$2,$3)',[actor,'Acceptance '+name,email]);
    await owner.query("INSERT INTO core.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'member')",[tenant,actor]);
    await owner.query("INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES($1,$2,$3,'active')",[tenant,portal,actor]);
    await owner.query('INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) SELECT $1,$2,id FROM public.portal_roles WHERE portal_id=$1 AND name=ANY($3::text[])',[portal,actor,roles]);
    actors[name]={tenant,portal,actor,email,name:'Acceptance '+name,workspaceName:'Reporter AI',workspaceSlug:'reporter-ai',roles};
  }
}finally{await owner.end();}
const as=(who,fn)=>runWithReporterContext(actors[who],fn);
async function rpc(who,method,...args){const r=await as(who,()=>editorialRpc({method,args,requestId:randomUUID()}));assert.equal(r.ok,true,`${method}: ${r.refusal?.code}: ${r.refusal?.message}`);return r.value;}
async function snapshot(who='editor'){return as(who,()=>editorialWorkspace());}
async function record(id){const s=await snapshot(),engine=createEditorialEngine(s,{next:randomUUID});try{return engine.records.record(id);}finally{engine.store.dispose();}}
async function waitRun(id){for(let n=0;n<180;n++){const s=await snapshot(),run=s.state.runFolds[id]?.run;if(run?.status==='completed')return;if(run?.status==='failed'||run?.status==='cancelled')throw new Error('Live generation failed: '+JSON.stringify(run.error));if(n%10===0)console.log('Waiting for deployed worker: '+(run?.steps?.find(step=>step.state==='current')?.id??run?.status));await delay(5000);}throw new Error('Live generation timed out.');}

const settings=await as('editor',()=>editorialPipeline());
await rpc('editor','pipeline.save',defaultPipelineDefinition('openai/gpt-4.1'),settings.active?.revision??settings.revision);
// Exercise the deployed storage trigger, media executables and Groq transcription.
const speech=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:'gpt-4o-mini-tts',voice:'alloy',input:'Este é um material sintético de teste. A biblioteca prepara quatro oficinas gratuitas de leitura. A programação depende da confirmação dos voluntários. Nenhum resultado de público foi medido.'}),signal:AbortSignal.timeout(60000)});
assert.equal(speech.ok,true,'Synthetic audio generation failed');const audio=Buffer.from(await speech.arrayBuffer()),sourceId=randomUUID(),uploadToken=randomUUID()+randomUUID();
const intake=await as('editor',()=>transaction('runtime',async db=>(await db.query('SELECT public.reporter_prepare_cloud_upload($1,$2,$3,$4,$5,$6,$7) AS value',
  [sourceId,'synthetic-acceptance.mp3',audio.length,'audio/mpeg',`incoming/${portal}/${sourceId}.mp3`,createHash('sha256').update(uploadToken).digest('hex'),randomUUID()])).rows[0].value));
async function uploadCall(path){const r=await fetch(new URL(path,process.env.NEON_FUNCTION_REPORTERWORKER_BASE_URL),{method:'POST',headers:{origin:'https://reporter-ai-three.vercel.app','content-type':'application/json'},body:JSON.stringify({sourceId,token:uploadToken}),signal:AbortSignal.timeout(120000)});assert.equal(r.ok,true,'Deployed '+path+' failed');return r.json();}
const upload=await uploadCall('/uploads/start');
for(const part of upload.parts){const start=(part.number-1)*upload.partSize;assert.equal((await fetch(part.url,{method:'PUT',body:audio.subarray(start,Math.min(audio.length,start+upload.partSize))})).ok,true);}
await uploadCall('/uploads/complete');let transcript;
for(let n=0;n<60;n++){
  transcript=await as('editor',()=>transaction('runtime',async db=>(await db.query('SELECT public.reporter_local_transcript($1) AS value',[intake.id])).rows[0].value));
  if(transcript.status==='ready')break;if(transcript.status==='failed')throw new Error('Live transcription failed: '+transcript.error_code);await delay(5000);
}
assert.equal(transcript?.status,'ready','Live transcription did not finish');assert.ok(transcript.content.length>40);
console.log('PASS private multipart upload, actual storage trigger, media execution and live Groq transcription.');
const created=await rpc('editor','createFromSource',{title:'Synthetic acceptance — Ateliê Sul',material:{text:'MATERIAL SINTÉTICO DE ACEITE. Pessoas, empresa e números fictícios.\n\n'+ATELIE_SUL_TRANSCRIPT,origin:'interview',authorized:true},brief:{sections:3,size:'standard',angle:'Relate a organização da produção e a expansão comercial, deixando explícito que se trata de uma simulação.'},plan:['article','carousel']});
const article=created.pieces.find(piece=>piece.kind==='article');assert.ok(article);
const draft=await rpc('editor','generation.start','article.draft',{productionId:created.productionId,pieceId:article.pieceId});await waitRun(draft.runId);
console.log('PASS live article generation with deployed Neon worker and OpenAI.');
const bytes=await sharp({create:{width:2400,height:1350,channels:3,background:'#667788'}}).png().toBuffer();
const prepared=await as('editor',()=>prepareAssetUpload({id:randomUUID(),fileName:'synthetic-acceptance.png',mime:'image/png',size:bytes.length,hash:createHash('sha256').update(bytes).digest('hex'),meta:{productionId:created.productionId,authorized:true,credit:'Imagem sintética de teste'}}));
assert.equal((await fetch(prepared.url,{method:'PUT',headers:{'content-type':'image/png'},body:bytes})).ok,true);
const image=await as('editor',()=>completeAssetUpload({token:prepared.token}));
const fresh=await snapshot('reviewer'),stored=fresh.imageAssets.find(entry=>entry.asset.id===image.id);assert.ok(stored?.fileKey);
assert.equal(createHash('sha256').update(await as('reviewer',()=>readImageFile(stored.fileKey))).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
console.log('PASS durable image upload and fresh reviewer retrieval from Neon Object Storage.');
let current=await record(created.productionId),piece=current.pieces.find(piece=>piece.id===article.pieceId);
const body=markTextReviewed(piece.draft.body);body.cover={assetId:image.id,alt:'Imagem sintética de aceite'};delete body.coverSlot;
body.blocks=body.blocks.map(block=>block.type==='figure'&&block.slot?{...block,slot:undefined,image:{assetId:image.id,alt:'Imagem sintética de aceite'}}:block);
await rpc('editor','saveDraft',piece.id,body,piece.draft.revision);
const requested=await rpc('editor','requestReview',piece.id,{assigneeId:actors.reviewer.actor});
await rpc('reviewer','decide',{pieceId:piece.id,subject:requested.request.subject,decision:'approved',displayedHash:requested.request.subject.hash});
console.log('PASS exact article approval by a second user without editing permission.');
current=await record(created.productionId);const approved=latestApproved(current,piece.id);assert.ok(approved);
await rpc('editor','derive',{productionId:created.productionId,kind:'carousel',from:approved.ref,templateId:'tpl-seafood-headline',rebase:true});
current=await record(created.productionId);piece=current.pieces.find(piece=>piece.kind==='carousel');assert.ok(piece);
const carousel=await rpc('editor','generation.start','carousel.copy',{productionId:created.productionId,pieceId:piece.id,from:approved.ref});await waitRun(carousel.runId);
current=await record(created.productionId);piece=current.pieces.find(candidate=>candidate.id===piece.id);
await rpc('editor','saveDraft',piece.id,{...piece.draft.body,slides:piece.draft.body.slides.map(slide=>({...slide,ai:'reviewed'}))},piece.draft.revision);
const carouselReview=await rpc('editor','requestReview',piece.id,{assigneeId:actors.reviewer.actor});
await rpc('reviewer','decide',{pieceId:piece.id,subject:carouselReview.request.subject,decision:'approved',displayedHash:carouselReview.request.subject.hash});
console.log('PASS live carousel generation and second-user approval.');
const state=await snapshot();
const {validateExport}=await import('./neon-render-acceptance.mjs');
await as('editor',()=>validateExport(state,created.productionId));
await rpc('editor','recordDelivery',{productionId:created.productionId,selection:[approved.ref,carouselReview.request.subject],mode:'download',files:[{fileName:'acceptance.md',format:'md',versionId:approved.ref.versionId,ok:true}]});
console.log('PASS complete Neon editorial flow and delivery receipt.');
const {pool}=await import('../src/server/database.ts');await Promise.all(['runtime','worker'].map(role=>pool(role).end()));
