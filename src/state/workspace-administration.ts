'use client';
import {useEffect,useState} from 'react';
import type {WorkspaceAdministration,WorkspaceResult} from '../ports/workspace-management.ts';
import {WORKSPACE_MESSAGES} from '../domain/workspace-management.ts';
import {useRuntime} from './use-runtime.ts';

export function useWorkspaceAdministration(){return useRuntime().runtime?.administration;}
/** Answers survive a refresh only inside the same port and query key. */
export function useAdministrationQuery<T>(port:WorkspaceAdministration|undefined,key:string,load:(port:WorkspaceAdministration)=>Promise<WorkspaceResult<T>>){
  const [version,setVersion]=useState(0);
  const [answer,setAnswer]=useState<{port:WorkspaceAdministration;key:string;version:number;result:WorkspaceResult<T>}>();
  useEffect(()=>port?.subscribe(()=>setVersion(value=>value+1)),[port]);
  useEffect(()=>{
    if(!port)return;
    let live=true;
    void load(port).catch(()=>({ok:false as const,refusal:{code:'unavailable' as const,message:WORKSPACE_MESSAGES.unavailable}})).then(result=>{
      if(live)setAnswer({port,key,version,result});
    });return()=>{live=false;};
    // The complete key names the load; callbacks are intentionally recreated by screens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[port,key,version]);
  const current=answer?.port===port&&answer?.key===key?answer:undefined;
  return{data:current?.result.ok?current.result.value:undefined,error:current&&!current.result.ok?current.result.refusal:undefined,
    loading:!current&&Boolean(port),refreshing:current?.version!==version,retry:()=>setVersion(value=>value+1)};
}
