import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReporterTransport } from './reporter-client.ts';
import { createHttpNewsIntake } from './news-intake.ts';
import { createHttpCitationLibrary } from './citation-library.ts';

test('each runtime captures its workspace for immediate and queued requests',async()=>{
  const original=globalThis.fetch,requests:string[]=[];
  globalThis.fetch=async input=>{requests.push(String(input));return Response.json({items:[]});};
  const a=createReporterTransport('client-one'),b=createReporterTransport('client-two');
  try{
    const queued=Promise.resolve().then(()=>a.request('/workspace',{method:'rename'}));
    await Promise.all([queued,b.request('/workspace'),createHttpNewsIntake(a).read(),createHttpCitationLibrary(b).get()]);
    assert.ok(requests.includes('/api/reporter/w/client-one/workspace'));
    assert.ok(requests.includes('/api/reporter/w/client-two/workspace'));
    assert.ok(requests.includes('/api/reporter/w/client-one/news'));
    assert.ok(requests.includes('/api/reporter/w/client-two/citations'));
    assert.ok(requests.every(url=>url.startsWith('/api/reporter/w/')));
  }finally{a.dispose();b.dispose();globalThis.fetch=original;}
});

test('a disposed context discards a late response and cannot issue another write',async()=>{
  const original=globalThis.fetch;
  let resolve!:(response:Response)=>void;
  globalThis.fetch=()=>new Promise<Response>(done=>{resolve=done;});
  const context=createReporterTransport('client-one');
  try{
    const pending=context.request('/workspace');
    const discarded=assert.rejects(pending,{name:'AbortError'});
    context.dispose();resolve(Response.json({error:'AUTH_REQUIRED'},{status:401}));
    await discarded;
    await assert.rejects(context.request('/workspace',{method:'rename'}),{name:'AbortError'});
  }finally{context.dispose();globalThis.fetch=original;}
});

test('writes wait for the authoritative account and cannot be relabeled after it changes',async()=>{
  const original=globalThis.fetch,accounts:(string|null)[]=[];
  globalThis.fetch=async(_input,init)=>{accounts.push(new Headers(init?.headers).get('x-reporter-account'));return Response.json({ok:true});};
  const context=createReporterTransport('client-one',{requireAccount:true});
  try{
    await assert.rejects(context.request('/workspace',{}),{name:'InvalidStateError'});
    assert.equal(accounts.length,0);
    context.bindAccount('account-one');await context.request('/workspace',{});
    assert.deepEqual(accounts,['account-one']);
    assert.throws(()=>context.bindAccount('account-two'),/ACCOUNT_CONTEXT_CHANGED/);
    await assert.rejects(context.request('/workspace',{}),{name:'AbortError'});
  }finally{context.dispose();globalThis.fetch=original;}
});

test('account or membership invalidation closes the context, but ordinary role refusals do not',async()=>{
  const original=globalThis.fetch;let invalidated=0,code='FORBIDDEN';
  globalThis.fetch=async()=>Response.json({error:code},{status:403});
  const context=createReporterTransport('client-one',{onInvalidated:()=>{invalidated++;}});
  try{
    context.bindAccount('account-one');
    await assert.rejects(context.request('/workspace',{}),{code:'FORBIDDEN'});assert.equal(invalidated,0);
    code='WORKSPACE_NOT_FOUND';await assert.rejects(context.request('/workspace'),{code});assert.equal(invalidated,1);
    await assert.rejects(context.request('/workspace',{}),{name:'AbortError'});
  }finally{context.dispose();globalThis.fetch=original;}
});

test('a denied client never auto-opens a previous client, and an unverified account goes to access review',async()=>{
  const browser=globalThis as unknown as {window?:unknown},before=browser.window,original=globalThis.fetch,destinations:string[]=[];
  browser.window={location:{replace:(href:string)=>destinations.push(href)}};
  try{
    for(const [code,status,destination]of[['WORKSPACE_NOT_FOUND',404,'/workspaces?unavailable=1'],['ACCOUNT_CONTEXT_CHANGED',409,'/workspaces'],['EMAIL_NOT_VERIFIED',403,'/auth/pending'],['AUTH_REQUIRED',401,'/auth/sign-in']]as const){
      globalThis.fetch=async()=>Response.json({error:code},{status});const context=createReporterTransport('requested-client');
      await assert.rejects(context.request('/workspace'),{code});assert.equal(destinations.at(-1),destination);context.dispose();
    }
  }finally{browser.window=before;globalThis.fetch=original;}
});

test('view transports capture the real account and segregate even ordinary image URLs',async()=>{
  const original=globalThis.fetch,requests:{url:string;headers:Headers}[]=[];
  globalThis.fetch=async(input,init)=>{requests.push({url:String(input),headers:new Headers(init?.headers)});return Response.json({});};
  const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const a=createReporterTransport('client-one',{viewId:first}),b=createReporterTransport('client-one',{viewId:second});
  try{
    a.bindAccount('actual-operator');
    await a.fetch('/visuals/assets/same/file?size=large',{headers:{'x-reporter-view':second}});
    assert.equal(requests[0].url,`/api/reporter/w/client-one/visuals/assets/same/file?size=large&_view=${first}`);
    assert.equal(requests[0].headers.get('x-reporter-view'),first);
    assert.equal(requests[0].headers.get('x-reporter-account'),'actual-operator');
    assert.notEqual(a.url('/visuals/assets/same/file'),b.url('/visuals/assets/same/file'));
    assert.throws(()=>createReporterTransport(undefined,{viewId:first}),/INVALID_MEMBER_VIEW/);
    assert.throws(()=>createReporterTransport('client-one',{viewId:'invalid'}),/INVALID_MEMBER_VIEW/);
  }finally{a.dispose();b.dispose();globalThis.fetch=original;}
});

test('a read-only refusal retains the view, while expiry clears it into an explicit choice',async()=>{
  const browser=globalThis as unknown as {window?:unknown},before=browser.window,original=globalThis.fetch,destinations:string[]=[];
  let code='MEMBER_VIEW_READ_ONLY',invalidated=0;
  browser.window={location:{replace:(href:string)=>destinations.push(href)}};
  globalThis.fetch=async()=>Response.json({error:code},{status:code==='MEMBER_VIEW_ENDED'?410:403});
  const context=createReporterTransport('client-one',{viewId:'11111111-1111-4111-8111-111111111111',onInvalidated:()=>{invalidated++;}});
  try{
    context.bindAccount('actual-operator');await assert.rejects(context.request('/workspace',{}),{code});
    assert.equal(invalidated,0);assert.deepEqual(destinations,[]);
    code='MEMBER_VIEW_ENDED';await assert.rejects(context.request('/workspace'),{code});
    assert.equal(invalidated,1);assert.deepEqual(destinations,['/workspaces?viewing=ended']);
    await assert.rejects(context.request('/workspace'),{name:'AbortError'});
  }finally{context.dispose();browser.window=before;globalThis.fetch=original;}
});
