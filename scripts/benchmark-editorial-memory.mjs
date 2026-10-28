import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
// Optional synthetic read benchmark; uses a disposable database and makes no provider calls.
const root=new URL('../',import.meta.url), moduleAt=path=>new URL(path,root).href;
const require=createRequire(new URL('package.json',root)), pg=require('pg');
const { startRehearsalDatabase }=await import(moduleAt('tests/support/rehearsal-db.ts'));
const { createTranscriptSource,toSourceVersionRef }=await import(moduleAt('src/domain/source.ts'));
const { parseTranscript }=await import(moduleAt('src/domain/text/transcript-parse.ts'));
const { memoryEvidenceRef }=await import(moduleAt('src/domain/editorial-memory.ts'));
const identity={subject:'memory-benchmark',email:'memory-benchmark@memory.test',name:'Synthetic benchmark editor',emailVerified:true};
const db=await startRehearsalDatabase([{email:identity.email,role:'editor'}]);
const admin=new pg.Client({connectionString:db.owner});
try {
  await admin.connect();
  await admin.query('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1',[identity.email,identity.subject]);
  Object.assign(process.env,{REPORTER_DEPLOYMENT_MODE:'cloud',REPORTER_DATABASE_URL:db.runtime,REPORTER_WORKER_DATABASE_URL:db.worker,
    REPORTER_WORKER_PASSWORD:db.workerPassword,REPORTER_DEFAULT_PORTAL_ID:'10000000-0000-0000-0000-000000000101',REPORTER_WORKSPACES_MODE:'all',REPORTER_MEMORY_MODE:'on'});
  const { resolveReporterContext }=await import(moduleAt('src/server/database.ts'));
  const context=await resolveReporterContext(identity,'reporter-ai');
  if(!context)throw new Error('Missing benchmark context');
  const source=createTranscriptSource({workspaceId:context.portal,title:'Synthetic benchmark source',origin:'interview',authorized:true,
    parsed:parseTranscript('Ana Exemplo: A unidade sintética treinou 240 pessoas no período observado.',{format:'speaker-lines'}),speakerPeople:{'Ana Exemplo':context.actor}},
    {actorId:context.actor,now:'2026-01-01T00:00:00Z',newId:()=> 'benchmark-source'});
  const metadata={publishedOn:null,recordedOn:null,institution:null,company:null,event:null,edition:null,topics:['benchmark'],originalUrl:null};
  const material={id:'benchmark-material',workspaceId:context.portal,revision:1,title:'Synthetic benchmark material',kind:'transcript',source:toSourceVersionRef(source),metadata,
    importedAt:'2026-01-01T00:00:00Z',importedBy:context.actor,primaryOrigin:'synthetic:benchmark',originalFileId:null};
  await admin.query('INSERT INTO public.reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)',[context.portal,source.id,JSON.stringify(source)]);
  const runtime=new pg.Client({connectionString:db.runtime});await runtime.connect();
  try {
    await runtime.query('BEGIN');
    await runtime.query("SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true)",[context.tenant,context.portal,context.actor]);
    await runtime.query('SELECT public.reporter_memory_put($1::jsonb)',[JSON.stringify({kind:'material',id:material.id,expected:null,doc:material,sourceId:source.id})]);
    await runtime.query('COMMIT');
  } finally {await runtime.end();}
  const segment=source.versions[0].content.segments[0], values=[];
  for(let i=0;i<10000;i++){
    const base={id:`benchmark-${String(i).padStart(5,'0')}`,workspaceId:context.portal,materialId:material.id,revision:0,metadata,kinds:['declared'],status:'active',
      createdAt:new Date(Date.parse('2026-01-01T00:00:00Z')+i).toISOString(),updatedAt:'2026-01-01T00:00:00Z',supersedes:null,
      anchor:{source:material.source,spans:[{segmentId:segment.id,from:0,to:segment.text.length}],excerpt:segment.text}};
    const doc=i%2===0?{...base,kind:'citation',text:segment.text,personId:context.actor,authorConfirmed:true,legacyCitationId:null}:
      {...base,kind:'statistic',indicator:`Treinamento sintético ${i}`,value:{raw:'240',decimal:'240',lower:null,upper:null,scale:null},unit:'pessoas',period:null,geography:null,
        population:null,qualifier:null,issuingInstitution:null,declaringPersonId:context.actor};
    values.push({doc,fingerprint:memoryEvidenceRef(doc).hash});
  }
  await admin.query('BEGIN');
  const [{seq}]=(await admin.query('SELECT seq FROM public.reporter_memory_clock WHERE portal_id=$1 FOR UPDATE',[context.portal])).rows;
  await admin.query(`INSERT INTO public.reporter_memory_heads(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    SELECT $1,'evidence',value->'doc'->>'id',0,value->'doc',value->>'fingerprint','material',$3,$4,NULL,$5::bigint+n FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY rows(value,n)`,
    [context.portal,JSON.stringify(values),material.id,source.id,seq]);
  await admin.query(`INSERT INTO public.reporter_memory_history(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq)
    SELECT portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,origin_production_id,seq FROM public.reporter_memory_heads WHERE portal_id=$1 AND kind='evidence'`,[context.portal]);
  await admin.query('UPDATE public.reporter_memory_clock SET seq=seq+10000 WHERE portal_id=$1',[context.portal]);await admin.query('COMMIT');
  await admin.query('ANALYZE public.reporter_memory_heads');await admin.query('ANALYZE public.reporter_memory_history');
  const { handleReporter }=await import(moduleAt('src/server/http.ts'));
  const scenarios=[{name:'newest',query:'limit=50'},{name:'search_relevance',query:'limit=50&q=treinou&topic=benchmark&sort=relevance'}];
  for(const scenario of scenarios){
    const samples=[];
    for(let i=0;i<23;i++){
      const start=performance.now();
      const response=await handleReporter(new Request(`http://127.0.0.1:3992/api/reporter/w/reporter-ai/memory?${scenario.query}`),['w','reporter-ai','memory'],{identify:async()=>identity});
      if(response.status!==200){
        const { runWithReporterContext }=await import(moduleAt('src/server/request-context.ts'));
        const { queryEditorialMemory }=await import(moduleAt('src/server/editorial-memory-query.ts'));
        const { parseMemoryQuery }=await import(moduleAt('src/server/editorial-memory-input.ts'));
        try {await runWithReporterContext(context,()=>queryEditorialMemory(parseMemoryQuery(new URLSearchParams(scenario.query))));}
        catch(error){console.log(JSON.stringify({scenario:scenario.name,error_name:error.name,error_code:error.code??null,duration_ms:Math.round(performance.now()-start)}));}
        throw new Error(`Benchmark HTTP status ${response.status}`);
      }
      const result=await response.json();
      if(result.total!==10000||result.items.length!==50)throw new Error('Benchmark returned incorrect totals');
      if(i>=3)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);
    console.log(JSON.stringify({scenario:scenario.name,records:10000,materials:1,kinds:['citation','statistic'],limit:50,warmups:3,samples:samples.length,
      p50_ms:Number(samples[Math.ceil(samples.length*.5)-1].toFixed(1)),p95_ms:Number(samples[Math.ceil(samples.length*.95)-1].toFixed(1)),max_ms:Number(samples.at(-1).toFixed(1)),
      scope:'Synthetic local PostgreSQL + actual API/authz; injected authenticated identity; not real-corpus, provider, remote-network or UI performance'}));
  }
} finally {
  await admin.end().catch(()=>{});
  for(const pool of Object.values(globalThis.reporterPools??{}))await pool?.end();
  db.stop();
}
