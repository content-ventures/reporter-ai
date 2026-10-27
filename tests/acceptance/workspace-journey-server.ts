import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {ArticleBody} from '../../src/domain/article.ts';
import {articlePlainText,markTextReviewed} from '../../src/domain/article.ts';
import type {CarouselBody} from '../../src/domain/carousel.ts';
import type {SourceRef} from '../../src/domain/refs.ts';
import type {ConnectedWorkspace} from '../../src/ports/connected-workspace.ts';
import {createEditorialEngine,editorialCandidates} from '../../src/runtime/editorial-engine.ts';
import {validPipelineOutput} from '../../src/server/pipeline-output.ts';
import {currentWorkerContext} from '../../src/server/worker-context.ts';
import {sampleJson} from '../support/fake-providers.ts';
import {startWorkspaceScenario,type ScenarioActor} from '../support/workspace-scenario.ts';

const quoteA='A previsão depende de testes reais.',quoteB='Ainda não temos um calendário definido.',quoteC='A revisão humana faz parte de cada etapa.';
const filler='A equipe avalia os dados da fonte e mantém o plano em teste. ';
const secondFiller='A fonte registra o andamento do teste e acompanha os dados da equipe. ';
const thirdFiller='O plano segue em avaliação com os dados registrados pela equipe. ';
const transcript=[quoteA,quoteB,quoteC,filler.repeat(20),secondFiller.repeat(20),thirdFiller.repeat(20)].join('\n\n');
type Schema={type?:string;enum?:unknown[];maxLength?:number;properties?:Record<string,Schema>;items?:Schema};
function bounded(schema:Schema,value:unknown):unknown{
  if(schema.enum)return value;
  if(typeof value==='string')return value.slice(0,schema.maxLength??value.length);
  if(Array.isArray(value))return value.map(item=>bounded(schema.items??{},item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,bounded(schema.properties?.[key]??{},item)]));
  return value;
}
async function main(){
  const scenario=await startWorkspaceScenario({editors:2,frontendOrigin:process.env.REPORTER_TEST_FRONTEND_ORIGIN});
  const fake=globalThis.fetch,outputs=new Map<string,{intro:{text:string;evidenceIds:string[]}[];sections:{title:string;paragraphs:{text:string;evidenceIds:string[]}[]}[];next:number}>();
  const carouselSources=new Map<string,string>();
  const prompts:Array<{client:string;run:string}>=[];
  let stopped=false;
  const stop=async()=>{if(stopped)return;stopped=true;globalThis.fetch=fake;await scenario.stop();};
  process.once('SIGTERM',()=>{void stop().finally(()=>{process.disconnect?.();});});
  try{
    globalThis.fetch=async(input,init)=>{
      if(String(input).startsWith('https://api.groq.com/openai/v1/chat/completions')){
        const context=currentWorkerContext()!,client=scenario.clients.find(client=>client.id===context.portal)!;
        const messages=JSON.stringify(JSON.parse(String(init?.body)).messages),label=client===scenario.clients[0]?'Alpha':'Beta';
        assert.ok(messages.includes('Exclusive audience '+label));assert.ok(messages.includes('Exclusive voice '+label));
        assert.ok(!messages.includes('Exclusive voice '+(label==='Alpha'?'Beta':'Alpha')));
        const schema=JSON.parse(String(init?.body)).response_format.json_schema.schema as Schema,fixture=outputs.get(context.job!.id);
        let value:unknown;
        if(schema.properties?.slides){value=bounded(schema,sampleJson(schema));for(const slide of Object.values((value as {slides:Record<string,{sourceBlockIds:string[]}>}).slides))slide.sourceBlockIds=[carouselSources.get(context.job!.id)!];}
        else if(schema.properties?.paragraphs){assert.ok(fixture,'a source draft must use its own run fixture');
          value=schema.properties.title?fixture.sections[fixture.next++]:{paragraphs:fixture.intro};assert.ok(value,'unexpected repeated section request');
        }else return fake(input,init);
        assert.ok(validPipelineOutput(schema.properties?.slides?'carousel':schema.properties?.title?'section':'intro',value,schema),JSON.stringify({schema,value}));
        prompts.push({client:label,run:context.job!.id});
        return Response.json({id:'synthetic-journey-'+prompts.length,usage:{prompt_tokens:10,completion_tokens:10},choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
      }
      return fake(input,init);
    };
    const snapshot=async(actor:ScenarioActor,slug:string)=>(await scenario.call<ConnectedWorkspace>(actor,`/api/reporter/w/${slug}/workspace`)).value;
    const record=async(actor:ScenarioActor,slug:string,id:string)=>{
      const data=await snapshot(actor,slug),engine=createEditorialEngine(data,{next:()=>randomUUID()});
      try{return engine.records.record(id)!;}finally{engine.store.dispose();}
    };
    const completed=async(actor:ScenarioActor,slug:string,runId:string)=>{
      for(let turn=0;turn<4;turn++){
        await scenario.drain();const run=(await snapshot(actor,slug)).state.runFolds[runId]?.run;
        if(run?.status==='completed')return;
        assert.ok(run&&!['failed','cancelled'].includes(run.status),JSON.stringify(run?.error));
      }
      throw new Error('The bounded synthetic run did not finish: '+JSON.stringify((await snapshot(actor,slug)).state.runFolds[runId]));
    };
    const productions:Array<{id:string;workspaceId:string;slug:string;client:number;event:string;editorId:string;reviewerId:string;assetId:string;photoHash:string;photoColor:{r:number;g:number;b:number};title:string}>=[];
    for(const[index,event]of[[0,'Feira Aurora 2026'],[1,'Feira Natural 2026'],[0,'Encontro Aurora 2027']]as const){
      const client=scenario.clients[index],editor=scenario.editors[index],reviewer=index===1?scenario.editors[0]:scenario.reviewers[index];
      const title=`${client.marker} — ${event}`;
      const created=await scenario.rpc<{productionId:string;pieces:{kind:string;pieceId:string}[]}>(editor,client.slug,'createFromSource',{
        title,material:{text:transcript,format:'auto',origin:'event',authorized:true},brief:{size:'standard',sections:2,format:'stand',formatSize:'full',event:{name:event,venue:'Pavilhão de testes',dates:'Material sintético de aceite'}},plan:['article','carousel'],
      });
      const article=created.pieces.find(piece=>piece.kind==='article')!;
      const candidates=editorialCandidates(await record(editor,client.slug,created.productionId));
      const refs=[quoteA,quoteB,quoteC].map(quote=>{const found=candidates.find(candidate=>candidate.text.includes(quote));assert.ok(found);return found;});
      const outline={title,intro:{quotes:[refs[2].ref as SourceRef]},sections:[{blockId:randomUUID(),title:'Dados da fonte',quotes:[refs[0].ref]},{blockId:randomUUID(),title:'Próximos testes',quotes:[refs[1].ref]}]};
      scenario.hold();const started=await scenario.rpc<{runId:string}>(editor,client.slug,'generation.start','article.draft',{productionId:created.productionId,pieceId:article.pieceId,outline});
      outputs.set(started.runId,{intro:[{text:filler.repeat(10)+`A fonte afirma: “${quoteC}”`,evidenceIds:[refs[2].key]}],sections:[
        {title:'Dados da fonte',paragraphs:[{text:secondFiller.repeat(18)+`A fonte diz: “${quoteA}”`,evidenceIds:[refs[0].key]}]},
        {title:'Próximos testes',paragraphs:[{text:thirdFiller.repeat(18)+`A fonte explica: “${quoteB}”`,evidenceIds:[refs[1].key]}]},
      ],next:0});
      await completed(editor,client.slug,started.runId);
      const assetId=productions.length===2?randomUUID():'20000000-0000-4000-8000-000000000321',photoColor=index?{r:40,g:140,b:100}:{r:180,g:110,b:40};
      const bytes=await sharp({create:{width:1280,height:720,channels:3,background:photoColor}}).png().toBuffer(),photoHash=createHash('sha256').update(bytes).digest('hex');
      const prepared=await scenario.call<{url:string;token:string}>(editor,`/api/reporter/w/${client.slug}/visuals/assets/prepare`,{id:assetId,fileName:'source-photo.png',mime:'image/png',size:bytes.length,hash:photoHash,meta:{productionId:created.productionId,authorized:true,credit:`Imagem de teste ${index===0?'Alpha':'Beta'}`}});
      assert.equal(prepared.status,200,JSON.stringify(prepared.value));assert.equal((await fetch(prepared.value.url,{method:'PUT',headers:{'content-type':'image/png'},body:bytes})).status,200);
      assert.equal((await scenario.call(editor,`/api/reporter/w/${client.slug}/visuals/assets/complete`,{token:prepared.value.token})).status,200);
      let current=await record(editor,client.slug,created.productionId),piece=current.pieces.find(piece=>piece.id===article.pieceId)!;
      const body=markTextReviewed(piece.draft.body as ArticleBody);body.cover={assetId,alt:`Imagem autorizada de ${event}`};delete body.coverSlot;
      assert.ok(articlePlainText(body).includes(quoteA));assert.ok(articlePlainText(body).includes(quoteB));
      await scenario.rpc(editor,client.slug,'saveDraft',piece.id,body,piece.draft.revision);
      const requested=await scenario.rpc<{request:{subject:unknown}}>(editor,client.slug,'requestReview',piece.id,{assigneeId:reviewer.id});
      assert.equal((await scenario.call(editor,`/api/reporter/w/${client.slug}/workspace`,{method:'decide',args:[{pieceId:piece.id,subject:requested.request.subject,decision:'approved',displayedHash:(requested.request.subject as {hash:string}).hash}],requestId:randomUUID()})).status,403,'an editor cannot decide their own send');
      await scenario.rpc(reviewer,client.slug,'decide',{pieceId:piece.id,subject:requested.request.subject,decision:'approved',displayedHash:(requested.request.subject as {hash:string}).hash});
      await scenario.rpc(editor,client.slug,'derive',{productionId:created.productionId,kind:'carousel',from:requested.request.subject,templateId:client.templateId,rebase:true});
      current=await record(editor,client.slug,created.productionId);piece=current.pieces.find(piece=>piece.kind==='carousel')!;
      scenario.hold();const carousel=await scenario.rpc<{runId:string}>(editor,client.slug,'generation.start','carousel.copy',{productionId:created.productionId,pieceId:piece.id,from:requested.request.subject});
      carouselSources.set(carousel.runId,body.blocks.find(block=>block.type==='paragraph')!.id);
      await completed(editor,client.slug,carousel.runId);
      current=await record(editor,client.slug,created.productionId);piece=current.pieces.find(candidate=>candidate.id===piece.id)!;
      const carouselBody=piece.draft.body as CarouselBody;assert.equal(carouselBody.templateId,client.templateId);
      await scenario.rpc(editor,client.slug,'saveDraft',piece.id,{...carouselBody,slides:carouselBody.slides.map(slide=>({...slide,ai:'reviewed'}))},piece.draft.revision);
      const sent=await scenario.rpc<{request:{subject:{hash:string}}}>(editor,client.slug,'requestReview',piece.id,{assigneeId:scenario.reviewers[index].id});
      await scenario.rpc(scenario.reviewers[index],client.slug,'decide',{pieceId:piece.id,subject:sent.request.subject,decision:'approved',displayedHash:sent.request.subject.hash});
      productions.push({id:created.productionId,workspaceId:client.id,slug:client.slug,client:index,event,editorId:editor.id,reviewerId:reviewer.id,assetId,photoHash,photoColor,title});
    }
    assert.equal(scenario.clients.length,2);assert.equal(new Set(productions.filter(item=>item.client===0).map(item=>item.workspaceId)).size,1);
    process.send?.({type:'ready',base:scenario.base,origin:scenario.origin,clients:scenario.clients,productions,operator:scenario.operator,editors:scenario.editors,reviewers:scenario.reviewers,administrator:scenario.administrator,pendingActor:scenario.pendingActor,prompts});
    process.on('message',message=>{if((message as {type?:string})?.type==='stop')void stop().finally(()=>process.disconnect?.());});
  }catch(error){await stop();throw error;}
}
void main().catch(error=>{process.send?.({type:'failed',message:error instanceof Error?error.stack:String(error)});process.stderr.write(String(error instanceof Error?error.stack:error)+'\n');process.exitCode=1;process.disconnect?.();});
