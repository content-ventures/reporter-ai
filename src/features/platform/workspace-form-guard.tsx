'use client';
import {createContext,use,useCallback,useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {ConfirmDialog,toast} from '@content-ventures/design-system/v3';
import {useLeaveGuard} from '@/ui/shell/leave-guard';
import {useWorkspaceRouter} from '@/ui/workspace-navigation';
type Form={dirty:boolean;busy:boolean};
const Forms=createContext<((id:string,value:Form|undefined)=>void)|null>(null);
/** One decision covers all setup forms; an in-flight save must finish first. */
export function WorkspaceFormGuard({children}:{children:ReactNode}){
  const [forms,setForms]=useState(new Map<string,Form>()),[exit,setExit]=useState<string>(),departing=useRef(false),router=useWorkspaceRouter();
  const register=useCallback((id:string,value:Form|undefined)=>setForms(previous=>{const next=new Map(previous);if(value)next.set(id,value);else next.delete(id);return next;}),[]);
  const state=useMemo(()=>({dirty:[...forms.values()].some(form=>form.dirty),busy:[...forms.values()].some(form=>form.busy)}),[forms]);
  useLeaveGuard(state.dirty||state.busy,href=>{if(state.busy)toast('Aguarde a operação terminar antes de sair.');else setExit(href);});
  useEffect(()=>{if(!state.dirty&&!state.busy)return;const warn=(event:BeforeUnloadEvent)=>{if(!departing.current)event.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[state]);
  return<Forms value={register}>{children}<ConfirmDialog open={Boolean(exit)} onClose={()=>setExit(undefined)} title="Sair sem salvar?" description="Há configurações deste workspace que ainda não foram salvas." confirmLabel="Descartar e sair" cancelLabel="Continuar editando" tone="danger" onConfirm={()=>{if(!exit||state.busy)return;departing.current=true;router.push(exit);setExit(undefined);}}/></Forms>;
}
export function useWorkspaceForm(dirty:boolean,busy:boolean){
  const register=use(Forms),id=useId();
  useEffect(()=>{register?.(id,{dirty,busy});return()=>register?.(id,undefined);},[register,id,dirty,busy]);
}
