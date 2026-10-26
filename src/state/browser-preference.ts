'use client';
import {useCallback,useSyncExternalStore} from 'react';
const subscribers=new Map<string,Set<()=>void>>();
export function readBrowserPreference(key:string|undefined):string|null{
  try{return key?window.localStorage.getItem(key):null;}catch{return null;}
}
export function writeBrowserPreference(key:string|undefined,value:string){
  if(!key)return;
  try{window.localStorage.setItem(key,value);}catch{/* Storage is an optional convenience. */}
  for(const listener of subscribers.get(key)??[])listener();
}
/** No cached private value survives the owner; cross-tab events update only this key. */
export function useBrowserPreference(key:string|undefined):[string|null,(value:string)=>void]{
  const subscribe=useCallback((listener:()=>void)=>{
    if(!key)return()=>{};
    let entries=subscribers.get(key);if(!entries){entries=new Set();subscribers.set(key,entries);}entries.add(listener);
    const update=(event:StorageEvent)=>{if(event.key===key)listener();};window.addEventListener('storage',update);
    return()=>{entries.delete(listener);if(!entries.size)subscribers.delete(key);window.removeEventListener('storage',update);};
  },[key]);
  const read=useCallback(()=>readBrowserPreference(key),[key]),write=useCallback((value:string)=>writeBrowserPreference(key,value),[key]);
  return[useSyncExternalStore(subscribe,read,()=>null),write];
}
