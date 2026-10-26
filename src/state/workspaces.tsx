'use client';
import {createContext,use,useEffect,useRef,useState,type ReactNode} from 'react';
import type {WorkspaceDirectory,WorkspaceResult,WorkspaceAccessPage,WorkspaceSearch} from '../ports/workspace-management.ts';
import {createWorkspaceDirectoryRuntime} from '../runtime/create-workspace-directory.ts';
import {WORKSPACE_MESSAGES} from '../domain/workspace-management.ts';

const DirectoryContext=createContext<WorkspaceDirectory|null>(null);
export function WorkspaceDirectoryProvider({children}:{children:ReactNode}){
  const [runtime]=useState(createWorkspaceDirectoryRuntime),release=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{clearTimeout(release.current);return()=>{release.current=setTimeout(()=>runtime.dispose(),0);};},[runtime]);
  return<DirectoryContext value={runtime.directory}>{children}</DirectoryContext>;
}
export function useEntryDirectory(){const port=use(DirectoryContext);if(!port)throw new Error('WorkspaceDirectoryProvider is missing');return port;}
export function useWorkspaceDirectoryQuery(port:WorkspaceDirectory|undefined,options?:WorkspaceSearch){
  const key=JSON.stringify(options??{}),[version,setVersion]=useState(0);
  const [answer,setAnswer]=useState<{port:WorkspaceDirectory;key:string;version:number;result:WorkspaceResult<WorkspaceAccessPage>}>();
  useEffect(()=>{if(!port)return;let live=true;
    void port.accessible(options).catch(()=>({ok:false as const,refusal:{code:'unavailable' as const,message:WORKSPACE_MESSAGES.unavailable}})).then(result=>{if(live)setAnswer({port,key,version,result});});
    return()=>{live=false;};
    // Every search field is represented in the complete key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[port,key,version]);
  const current=answer?.port===port&&answer?.key===key?answer:undefined;
  return{data:current?.result.ok?current.result.value:undefined,error:current&&!current.result.ok?current.result.refusal:undefined,
    loading:Boolean(port)&&!current,refreshing:current?.version!==version,retry:()=>setVersion(value=>value+1)};
}
