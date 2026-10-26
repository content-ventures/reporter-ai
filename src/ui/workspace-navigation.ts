'use client';
import {createContext,use,useCallback,useEffect,useMemo,useRef} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {toast} from '@content-ventures/design-system/v3';
import {workspaceAddress,workspaceHref} from '../domain/workspace-address.ts';

type Href={ (href:string):string;(href:undefined):undefined;(href:string|undefined):string|undefined;(href:string|null|undefined):string|null|undefined };
export const WorkspaceAddressContext=createContext<{slug:string|undefined;prepare?:()=>Promise<boolean>;registerPreparation?:(prepare:()=>Promise<boolean>)=>()=>void}|null>(null);
/** Real hrefs, including modifier-clicks and copied addresses, retain the current client. */
export function useWorkspaceHref():Href{
  const bound=use(WorkspaceAddressContext),pathname=usePathname()??'';
  const slug=bound?bound.slug:workspaceAddress(pathname)?.slug;
  return useCallback((href:string|null|undefined)=>typeof href==='string'?workspaceHref(slug,href):href,[slug]) as Href;
}
/** Editors register their own queue, so pre-debounce edits finish before context disposal. */
export function useNavigationPreparation(prepare:()=>Promise<boolean>){
  const bound=use(WorkspaceAddressContext),latest=useRef(prepare);
  useEffect(()=>{latest.current=prepare;});
  useEffect(()=>bound?.registerPreparation?.(()=>latest.current()),[bound]);
}
export function useWorkspaceDeparture(){
  const bound=use(WorkspaceAddressContext);
  return useCallback(async()=>{const allowed=await bound?.prepare?.()??true;if(!allowed)toast('Salve as alterações antes de sair.',{tone:'error'});return allowed;},[bound]);
}
/** Programmatic product navigation follows the same address contract as visible links. */
export function useWorkspaceRouter():ReturnType<typeof useRouter>{
  const router=useRouter(),href=useWorkspaceHref(),prepare=useWorkspaceDeparture();
  return useMemo(()=>({...router,
    push:(path:string,options?:Parameters<typeof router.push>[1])=>{void prepare().then(allowed=>{if(allowed)router.push(href(path),options);});},
    replace:(path:string,options?:Parameters<typeof router.replace>[1])=>{void prepare().then(allowed=>{if(allowed)router.replace(href(path),options);});},
    prefetch:(path:string,options?:Parameters<typeof router.prefetch>[1])=>router.prefetch(href(path),options),
  }),[router,href,prepare]);
}
