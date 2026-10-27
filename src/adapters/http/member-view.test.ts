import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHttpMemberViewing} from './member-view.ts';
import {createReporterTransport} from './reporter-client.ts';

test('owned end auditing survives runtime disposal but cannot start another view afterwards',async()=>{
  const original=globalThis.fetch,requests:{path:string;init:RequestInit|undefined}[]=[];
  globalThis.fetch=async(path,init)=>{requests.push({path:String(path),init});return Response.json({ok:true});};
  const http=createReporterTransport(undefined,{requireAccount:true});http.bindAccount('actual-operator');
  const port=createHttpMemberViewing(http,async()=>{},()=> 'actual-operator');
  try{
    http.dispose();assert.equal((await port.end('11111111-1111-4111-8111-111111111111','workspace_changed')).ok,true);
    assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/reporter/member-views/11111111-1111-4111-8111-111111111111/end');
    assert.equal(new Headers(requests[0].init?.headers).get('x-reporter-account'),'actual-operator');assert.equal(requests[0].init?.keepalive,true);
    assert.equal((await port.start('workspace','member')).ok,false);assert.equal(requests.length,1);
  }finally{globalThis.fetch=original;}
});
