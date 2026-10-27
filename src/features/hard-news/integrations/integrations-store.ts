'use client';
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {useWorkspaceStorageKey} from '@/state/workspace-storage';
import {useRuntime} from '@/state';
import {createIntegrationsStore} from './integrations-browser-store';
export type {IntegrationsActions} from './integrations-browser-store';
export const INTEGRATIONS_KEY='reporter.r2-integrations.v1';
type Entry={store:ReturnType<typeof createIntegrationsStore>;retain:()=>()=>void};
const stores=new Map<string,Entry>();
function entryFor(key:string|undefined,example:boolean):Entry{
  const known=key?stores.get(key):undefined;if(known)return known;
  let owners=0,release:ReturnType<typeof setTimeout>|undefined;
  const entry:Entry={store:createIntegrationsStore(key,example),retain(){owners++;clearTimeout(release);return()=>{owners--;if(!owners)release=setTimeout(()=>{if(key&&stores.get(key)===entry)stores.delete(key);},0);};}};
  if(key)stores.set(key,entry);return entry;
}
/** Screens and drawers share one store inside the context; the last owner releases it. */
export function useIntegrations(){
  const key=useWorkspaceStorageKey(INTEGRATIONS_KEY),{runtime}=useRuntime(),example=runtime?.mode==='simulated';
  const entry=useMemo(()=>entryFor(key,example),[key,example]),store=entry.store;
  const current=useSyncExternalStore(store.subscribe,store.get,store.server);
  useEffect(()=>{
    const release=entry.retain();if(key)store.load();return release;
  },[key,entry,store]);
  return{...current,actions:store.actions};
}
