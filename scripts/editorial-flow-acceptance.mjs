import assert from 'node:assert/strict';
import { markTextReviewed } from '../src/domain/article.ts';
import { latestApproved } from '../src/domain/record.ts';
import { ATELIE_SUL_TRANSCRIPT } from '../src/fixtures/sources/atelie-sul.ts';
import { createHttpIngest } from '../src/adapters/http/reporter-client.ts';

// One scenario for offline preflight and isolated Neon acceptance. The transports
// differ; commands, permissions, approvals, rendering and delivery assertions do not.
export async function acceptEditorialFlow({rpc,snapshot,record,waitRun,analyzeMaterial,uploadImage,validateExport,reviewerId,sourceText,transcriptId}) {
const insights=await analyzeMaterial(sourceText,{fileName:'transcript.srt'});
assert.ok(insights.title.length>3);console.log('PASS material analysis of the uploaded source.');
const created=await rpc('editor','createFromSource',{title:'Acceptance — '+insights.title,material:{text:sourceText,transcriptId,format:'auto',origin:'interview',authorized:true},brief:{sections:3,size:'standard',angle:'Apresente os principais pontos da entrevista, usando apenas informações e citações verificáveis no material.'},plan:['article','carousel']});
const article=created.pieces.find(piece=>piece.kind==='article');assert.ok(article);
const draft=await rpc('editor','generation.start','article.draft',{productionId:created.productionId,pieceId:article.pieceId});await waitRun(draft.runId);
console.log('PASS article generation with the configured pipeline.');
const image=await uploadImage(created.productionId);
let current=await record(created.productionId),piece=current.pieces.find(piece=>piece.id===article.pieceId);
const body=markTextReviewed(piece.draft.body);body.cover={assetId:image.id,alt:'Imagem sintética de aceite'};delete body.coverSlot;
body.blocks=body.blocks.map(block=>{
  if(block.type!=='figure'||!block.slot)return block;
  const filled={...block,image:{assetId:image.id,alt:'Imagem sintética de aceite'}};
  delete filled.slot; // RPC arguments must contain JSON values, never undefined.
  return filled;
});
await rpc('editor','saveDraft',piece.id,body,piece.draft.revision);
const requested=await rpc('editor','requestReview',piece.id,{assigneeId:reviewerId});
await rpc('reviewer','decide',{pieceId:piece.id,subject:requested.request.subject,decision:'approved',displayedHash:requested.request.subject.hash});
console.log('PASS exact article approval by a second user without editing permission.');
current=await record(created.productionId);const approved=latestApproved(current,piece.id);assert.ok(approved);
await rpc('editor','derive',{productionId:created.productionId,kind:'carousel',from:approved.ref,templateId:'tpl-seafood-headline',rebase:true});
current=await record(created.productionId);piece=current.pieces.find(piece=>piece.kind==='carousel');assert.ok(piece);
const carousel=await rpc('editor','generation.start','carousel.copy',{productionId:created.productionId,pieceId:piece.id,from:approved.ref});await waitRun(carousel.runId);
current=await record(created.productionId);piece=current.pieces.find(candidate=>candidate.id===piece.id);
await rpc('editor','saveDraft',piece.id,{...piece.draft.body,slides:piece.draft.body.slides.map(slide=>({...slide,ai:'reviewed'}))},piece.draft.revision);
const carouselReview=await rpc('editor','requestReview',piece.id,{assigneeId:reviewerId});
await rpc('reviewer','decide',{pieceId:piece.id,subject:carouselReview.request.subject,decision:'approved',displayedHash:carouselReview.request.subject.hash});
console.log('PASS carousel generation and second-user approval.');
const state=await snapshot();
const exported=await validateExport(state,created.productionId);
await rpc('editor','recordDelivery',{productionId:created.productionId,selection:exported.selection,mode:'download',files:exported.outcomes});
assert.equal((await record(created.productionId)).deliveries.length,1,'Delivery receipt must persist');
console.log('PASS complete editorial flow and delivery receipt.');
const ingest=createHttpIngest({limits:{extensions:['.txt','.md','.srt','.vtt']}});
const textFile=await ingest.read(new File([ATELIE_SUL_TRANSCRIPT],'acceptance.txt',{type:'text/plain'}));
assert.equal(textFile.ok,true);assert.equal(textFile.value.text,ATELIE_SUL_TRANSCRIPT);
for(const [label,text] of [['pasted text',ATELIE_SUL_TRANSCRIPT],['UTF-8 file',textFile.value.text]]){
  const analyzed=await analyzeMaterial(text,{format:'auto'});
  const production=await rpc('editor','createFromSource',{title:`Acceptance ${label} — ${analyzed.title}`,material:{text,format:'auto',origin:'interview',authorized:true},brief:{sections:3,size:'standard',angle:'Relate os pontos principais da fonte, sem acrescentar fatos externos.'},plan:['article']});
  const piece=production.pieces.find(p=>p.kind==='article');
  const run=await rpc('editor','generation.start','article.draft',{productionId:production.productionId,pieceId:piece.pieceId});await waitRun(run.runId);
  const result=await record(production.productionId);assert.ok(result.pieces.find(p=>p.id===piece.pieceId)?.draft.body.blocks.length);
  console.log(`PASS ${label}, analysis and article generation.`);
}
}
