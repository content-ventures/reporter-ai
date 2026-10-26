'use client';
import {createContext,use,useCallback,useMemo} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {workspaceAddress,workspaceHref} from '../domain/workspace-address.ts';

type Href={ (href:string):string;(href:undefined):undefined;(href:string|undefined):string|undefined;(href:string|null|undefined):string|null|undefined };
export const WorkspaceAddressContext=createContext<{slug:string|undefined}|null>(null);
/** Real hrefs, including modifier-clicks and copied addresses, retain the current client. */
export function useWorkspaceHref():Href{
  const bound=use(WorkspaceAddressContext),pathname=usePathname()??'';
  const slug=bound?bound.slug:workspaceAddress(pathname)?.slug;
  return useCallback((href:string|null|undefined)=>typeof href==='string'?workspaceHref(slug,href):href,[slug]) as Href;
}
/** Programmatic product navigation follows the same address contract as visible links. */
export function useWorkspaceRouter():ReturnType<typeof useRouter>{
  const router=useRouter(),href=useWorkspaceHref();
  return useMemo(()=>({...router,
    push:(path:string,options?:Parameters<typeof router.push>[1])=>router.push(href(path),options),
    replace:(path:string,options?:Parameters<typeof router.replace>[1])=>router.replace(href(path),options),
    prefetch:(path:string,options?:Parameters<typeof router.prefetch>[1])=>router.prefetch(href(path),options),
  }),[router,href]);
}
