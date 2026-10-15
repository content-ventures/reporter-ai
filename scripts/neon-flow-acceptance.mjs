import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { basename,extname } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { runWithReporterContext } from '../src/server/request-context.ts';
import { editorialRpc,editorialWorkspace,editorialPipeline } from '../src/server/editorial.ts';
import { prepareAssetUpload,completeAssetUpload } from '../src/server/image-assets.ts';
import { readImageFile } from '../src/server/image-storage.ts';
import { ATELIE_SUL_TRANSCRIPT } from '../src/fixtures/sources/atelie-sul.ts';
import { markTextReviewed } from '../src/domain/article.ts';
import { latestApproved } from '../src/domain/record.ts';
import { createEditorialEngine } from '../src/runtime/editorial-engine.ts';
import { transaction } from '../src/server/database.ts';
import { analyzeMaterial } from '../src/server/material-analysis.ts';
import { createHttpIngest,transcriptFileText } from '../src/adapters/http/reporter-client.ts';

const acceptanceBranch=process.env.REPORTER_ACCEPTANCE_BRANCH;
if(!acceptanceBranch?.startsWith('br-')||acceptanceBranch===process.env.NEON_BRANCH_ID) throw new Error('This acceptance writes only to an isolated workflow-created Neon branch.');
const branchResponse=await fetch(`https://console.neon.tech/api/v2/projects/${process.env.NEON_PROJECT_ID}/branches/${acceptanceBranch}`,{headers:{Authorization:`Bearer ${process.env.NEON_API_KEY}`}});
assert.equal(branchResponse.ok,true,'Cannot verify isolated acceptance branch');
const {branch}=await branchResponse.json();
assert.ok(branch.name.startsWith('acceptance-')&&branch.parent_id===process.env.NEON_BRANCH_ID&&branch.expires_at,'Acceptance must target an expiring child of the production branch');
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
const snapshots=new Map();
async function snapshot(who='editor'){
  const previous=snapshots.get(who);
  const update=await as(who,()=>editorialWorkspace(previous?.syncToken));
  const current='unchanged' in update?{...previous,workerOnline:update.workerOnline}:update;
  assert.ok(current?.state,'Initial acceptance snapshot missing');snapshots.set(who,current);return current;
}
async function record(id){const s=await snapshot(),engine=createEditorialEngine(s,{next:()=>randomUUID()});try{return engine.records.record(id);}finally{engine.store.dispose();}}
async function waitRun(id){for(let n=0;n<180;n++){const s=await snapshot(),run=s.state.runFolds[id]?.run;if(run?.status==='completed')return;if(run?.status==='failed'||run?.status==='cancelled')throw new Error('Live generation failed: '+JSON.stringify(run.error));if(n%10===0)console.log('Waiting for deployed worker: '+(run?.steps?.find(step=>step.state==='current')?.id??run?.status));await delay(5000);}throw new Error('Live generation timed out.');}

const settings=await as('editor',()=>editorialPipeline());
const configured=JSON.parse(await readFile(process.env.REPORTER_ACCEPTANCE_PIPELINE_PATH,'utf8'));
if(configured)await rpc('editor','pipeline.save',configured,settings.active.revision);
let transcript;
if(process.env.REPORTER_ACCEPTANCE_TRANSCRIPT_ID){
  const id=process.env.REPORTER_ACCEPTANCE_TRANSCRIPT_ID;assert.match(id,/^[0-9a-f-]{36}$/);
  const check=new pg.Client({connectionString:url.toString()});
  try{await check.connect();await check.query('BEGIN READ ONLY');
    const source=(await check.query("SELECT s.size,s.status,s.provider,s.key FROM public.reporter_transcripts t JOIN core.storage_objects s ON s.id=t.source_object_id WHERE t.id=$1 AND t.portal_id=$2",[id,portal])).rows[0];
    assert.ok(source&&source.status==='completed'&&source.provider==='s3'&&source.key.startsWith('incoming/'+portal+'/'));
    if(process.env.REPORTER_ACCEPTANCE_MEDIA_BYTES)assert.equal(Number(source.size),Number(process.env.REPORTER_ACCEPTANCE_MEDIA_BYTES));
    await check.query('ROLLBACK');
  }finally{await check.end();}
  transcript=await as('editor',()=>transaction('runtime',async db=>(await db.query('SELECT public.reporter_local_transcript($1) AS value',[id])).rows[0].value));
  console.log('PASS verified original multipart source and completed transcript from the same isolated browser acceptance.');
}else{
// Exercise the deployed storage trigger, media executables and Groq transcription.
let audio,speechDirectory,fileName='synthetic-acceptance.mp3',contentType='audio/mpeg';
if(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH){
  fileName=basename(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH).normalize('NFC');
  contentType=extname(fileName).toLowerCase()==='.mp4'?'video/mp4':'audio/mpeg';
  audio=await openAsBlob(process.env.REPORTER_ACCEPTANCE_MEDIA_PATH,{type:contentType});
  if(process.env.REPORTER_ACCEPTANCE_MEDIA_BYTES)assert.equal(audio.size,Number(process.env.REPORTER_ACCEPTANCE_MEDIA_BYTES),'Original media size differs');
}else{
  speechDirectory=await mkdtemp(join(tmpdir(),'reporter-synthetic-speech-'));
  const path=join(speechDirectory,'speech.wav');
  const speech=spawnSync('espeak-ng',['--stdin','-v','pt-br','-s','150','-w',path],{input:'Material sintético de teste. '+ATELIE_SUL_TRANSCRIPT.slice(0,6000),encoding:'utf8',timeout:120000});
  if(speech.status!==0){await rm(speechDirectory,{recursive:true,force:true});throw new Error('Synthetic acceptance requires the offline espeak-ng fixture generator.');}
  fileName='synthetic-acceptance.wav';contentType='audio/wav';audio=await openAsBlob(path,{type:contentType});
}
const sourceId=randomUUID(),uploadToken=randomUUID()+randomUUID(),objectKey=`incoming/${portal}/${sourceId}${extname(fileName).toLowerCase()}`;
const intake=await as('editor',()=>transaction('runtime',async db=>(await db.query('SELECT public.reporter_prepare_cloud_upload($1,$2,$3,$4,$5,$6,$7) AS value',
  [sourceId,fileName,audio.size,contentType,objectKey,createHash('sha256').update(uploadToken).digest('hex'),randomUUID()])).rows[0].value));
async function uploadCall(path){const r=await fetch(new URL(path,process.env.NEON_FUNCTION_REPORTERWORKER_BASE_URL),{method:'POST',headers:{origin:'https://reporter-ai-three.vercel.app','content-type':'application/json'},body:JSON.stringify({sourceId,token:uploadToken}),signal:AbortSignal.timeout(120000)});assert.equal(r.ok,true,'Deployed '+path+' failed');return r.json();}
const upload=await uploadCall('/uploads/start');
for(const part of upload.parts){const start=(part.number-1)*upload.partSize;assert.equal((await fetch(part.url,{method:'PUT',body:audio.slice(start,Math.min(audio.size,start+upload.partSize))})).ok,true);console.log(`Uploaded part ${part.number}/${upload.parts.length} (${audio.size} original bytes).`);}
await uploadCall('/uploads/complete');if(speechDirectory)await rm(speechDirectory,{recursive:true,force:true});
for(let n=0;n<360;n++){
  transcript=await as('editor',()=>transaction('runtime',async db=>(await db.query('SELECT public.reporter_local_transcript($1) AS value',[intake.id])).rows[0].value));
  if(transcript.status==='ready')break;if(transcript.status==='failed')throw new Error('Live transcription failed: '+transcript.error_code);if(n%12===0)console.log('Waiting for transcription: '+JSON.stringify(transcript.job?.progress??transcript.status));await delay(5000);
}
}
assert.equal(transcript?.status,'ready','Live transcription did not finish');assert.ok(transcript.content.length>40);
console.log('PASS private multipart source, actual storage trigger, media execution and completed transcription.');
const sourceText=transcriptFileText(transcript);
const insights=await as('editor',()=>analyzeMaterial(sourceText,{fileName:'transcript.srt'}));
assert.ok(insights.title.length>3);console.log('PASS real material analysis of the uploaded source.');
const created=await rpc('editor','createFromSource',{title:'Acceptance — '+insights.title,material:{text:sourceText,transcriptId:transcript.id,format:'auto',origin:'interview',authorized:true},brief:{sections:3,size:'standard',angle:'Apresente os principais pontos da entrevista, usando apenas informações e citações verificáveis no material.'},plan:['article','carousel']});
const article=created.pieces.find(piece=>piece.kind==='article');assert.ok(article);
const draft=await rpc('editor','generation.start','article.draft',{productionId:created.productionId,pieceId:article.pieceId});await waitRun(draft.runId);
console.log('PASS live article generation with deployed Neon worker and the production pipeline.');
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
const exported=await as('editor',()=>validateExport(state,created.productionId));
await rpc('editor','recordDelivery',{productionId:created.productionId,selection:exported.selection,mode:'download',files:exported.outcomes});
console.log('PASS complete Neon editorial flow and delivery receipt.');
const ingest=createHttpIngest({limits:{extensions:['.txt','.md','.srt','.vtt']}});
const textFile=await ingest.read(new File([ATELIE_SUL_TRANSCRIPT],'acceptance.txt',{type:'text/plain'}));
assert.equal(textFile.ok,true);assert.equal(textFile.value.text,ATELIE_SUL_TRANSCRIPT);
for(const [label,text] of [['pasted text',ATELIE_SUL_TRANSCRIPT],['UTF-8 file',textFile.value.text]]){
  const analyzed=await as('editor',()=>analyzeMaterial(text,{format:'auto'}));
  const production=await rpc('editor','createFromSource',{title:`Acceptance ${label} — ${analyzed.title}`,material:{text,format:'auto',origin:'interview',authorized:true},brief:{sections:3,size:'standard',angle:'Relate os pontos principais da fonte, sem acrescentar fatos externos.'},plan:['article']});
  const piece=production.pieces.find(p=>p.kind==='article');
  const run=await rpc('editor','generation.start','article.draft',{productionId:production.productionId,pieceId:piece.pieceId});await waitRun(run.runId);
  const result=await record(production.productionId);assert.ok(result.pieces.find(p=>p.id===piece.pieceId)?.draft.body.blocks.length);
  console.log(`PASS ${label}, actual analysis and live article generation.`);
}
const {pool}=await import('../src/server/database.ts');await Promise.all(['runtime','worker'].map(role=>pool(role).end()));
