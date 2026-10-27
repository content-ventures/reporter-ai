'use client';
import {createContext,use,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Alert,Badge,Banner,Button,IconButton} from '@content-ventures/design-system/v3';
import {LogOut} from '@content-ventures/design-system/v3/icons';
import type {MemberView,MemberViewExit} from '@/domain/member-view';
import {NAVIGATION_DISCARD_EVENT} from '@/domain/workspace-address';
import {useRuntime,useSession} from '@/state';
import {useMediaQuery} from '../use-media-query';

type Controls={view:MemberView|undefined;busy:boolean;error:string|undefined;exit:(destination:string,reason?:MemberViewExit)=>Promise<void>};
const ViewContext=createContext<Controls|undefined>(undefined);
export function useMemberView(){const value=use(ViewContext);if(!value)throw new Error('MemberViewProvider is missing');return value;}
export function MemberViewProvider({children}:{children:ReactNode}){
  const {runtime}=useRuntime(),view=useSession().data?.navigation?.view;
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),pending=useRef(false);
  const exit=useCallback(async(destination:string,reason:MemberViewExit='exit')=>{
    if(pending.current)return;
    if(!view){window.location.assign(destination);return;}
    const port=runtime?.memberViewing;if(!port)return;
    pending.current=true;setBusy(true);setError(undefined);
    const result=await port.end(view.id,reason);
    if(result.ok||reason==='logout'){window.dispatchEvent(new Event(NAVIGATION_DISCARD_EVENT));window.location.assign(destination);return;}
    pending.current=false;setBusy(false);setError(result.refusal.message);
  },[view,runtime?.memberViewing]);
  useEffect(()=>{
    if(!view||!runtime?.memberViewing)return;
    const port=runtime.memberViewing;
    const timer=setTimeout(()=>{
      void port.end(view.id);
      window.dispatchEvent(new Event(NAVIGATION_DISCARD_EVENT));
      // Let the keepalive request start, then remove private content without waiting on its reply.
      queueMicrotask(()=>window.location.replace('/workspaces?viewing=ended'));
    },Math.max(0,view.remainingMs));
    return()=>clearTimeout(timer);
  },[view,runtime?.memberViewing]);
  const value=useMemo(()=>({view,busy,error,exit}),[view,busy,error,exit]);
  return<ViewContext value={value}>{children}</ViewContext>;
}
const returnToPerson=(view:MemberView)=>`/platform/people?person=${encodeURIComponent(view.person.id)}`;
/** Compact status remains in the sticky TopBar, including while the full notice is scrolled away. */
export function MemberViewStatus({demo=false}:{demo?:boolean}){
  const {view,busy,exit}=useMemberView();if(!view)return null;
  return<>{demo?<Badge tone="amber">Demo</Badge>:null}<Badge tone="amber">Somente leitura</Badge><IconButton icon={LogOut} size="sm" label={`Sair da visualização de ${view.person.name} em ${view.workspace.name}`} disabled={busy} onClick={()=>void exit(returnToPerson(view))}/></>;
}
export function MemberViewBanner(){
  const compact=useMediaQuery('(max-width: 1023px)');
  const {view,busy,error,exit}=useMemberView();if(!view)return null;
  // The sticky TopBar keeps its exit action on narrow screens; the band need not repeat it.
  return<><Banner title={`Visualizando ${view.person.name} · ${view.workspace.name}`} action={compact?undefined:<Button size="sm" loading={busy} onClick={()=>void exit(returnToPerson(view))}>Sair da visualização</Button>}/>
    {error?<Alert tone="danger" title="Não foi possível encerrar a visualização">{error}</Alert>:null}</>;
}
