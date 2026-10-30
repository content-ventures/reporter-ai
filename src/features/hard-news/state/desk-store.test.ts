import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeskStore} from './desk-store.ts';
import {initialState,STORAGE_KEY} from './hard-news-state.ts';

test('connected desks isolate clients and accounts without claiming unowned legacy records',()=>{
  const browser=globalThis as unknown as {window?:unknown},before=browser.window,storage=new Map<string,string>();
  browser.window={location:{href:'http://localhost/w/a/'},localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}};
  try{
    const legacy=JSON.stringify(initialState(0));storage.set(STORAGE_KEY,legacy);
    const a=createDeskStore({storageKey:'desk:client-a:account-one'}),b=createDeskStore({storageKey:'desk:client-b:account-one'}),other=createDeskStore({storageKey:'desk:client-a:account-two'});
    a.load();a.set(state=>({...state,map:{...state.map,audience:'Client A only'}}));b.load();other.load();
    assert.equal(a.get().state.map.audience,'Client A only');assert.equal(b.get().state.map.audience,'');assert.equal(other.get().state.map.audience,'');
    assert.equal(b.get().state.news.length,0);assert.equal(b.get().state.archive.length,0);assert.equal(b.get().state.cms.siteUrl,'');
    assert.equal(storage.get(STORAGE_KEY),legacy);
    const reload=createDeskStore({storageKey:'desk:client-a:account-one'});reload.load();assert.equal(reload.get().state.map.audience,'Client A only');assert.equal(reload.get().state.news.length,0);
    b.reset();assert.equal(a.get().state.map.audience,'Client A only');
  }finally{browser.window=before;}
});
