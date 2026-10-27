import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIntegrationsStore} from './integrations-browser-store.ts';
test('preview connections notify their readers and never populate another client from examples',()=>{
  const browser=globalThis as unknown as {window?:unknown},before=browser.window,storage=new Map<string,string>();
  browser.window={location:{href:'http://localhost/w/a/'},localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},addEventListener(){},removeEventListener(){}};
  try{
    const a=createIntegrationsStore('integrations:a:account',false),b=createIntegrationsStore('integrations:b:account',false);let refreshed=0;
    const release=a.subscribe(()=>{refreshed++;});a.load();b.load();a.actions.connectApp('slack',{account:'Client A preview'},'Owner A');
    assert.equal(a.get().state.apps.slack?.account,'Client A preview');assert.equal(b.get().state.apps.slack,undefined);assert.equal(refreshed,2);
    const reload=createIntegrationsStore('integrations:a:account',false);reload.load();assert.equal(reload.get().state.apps.slack?.account,'Client A preview');assert.equal(reload.get().state.endpoints.length,0);release();
  }finally{browser.window=before;}
});
