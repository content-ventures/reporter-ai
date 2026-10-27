'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {CONTEXT_RECOVERY_EVENT,contextRecoveryHref} from '@/domain/workspace-address';
import {subscribeAccountChange} from '@/lib/account-events';
/** A login or logout in another tab removes private views before opening the current account. */
export function AccountBoundary({children}:{children:ReactNode}){
  const [destination,setDestination]=useState<string>();
  useEffect(()=>{
    if(process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES==='true')return;
    const invalidate=(event:Event)=>{const code=(event as CustomEvent<{code?:unknown}>).detail?.code;if(typeof code!=='string')return;event.preventDefault();setDestination(contextRecoveryHref(code));};
    window.addEventListener(CONTEXT_RECOVERY_EVENT,invalidate);
    const stop=subscribeAccountChange(()=>{
      if(window.location.pathname.startsWith('/auth/'))return;
      setDestination('/workspaces?entry=1');
    });
    return()=>{stop();window.removeEventListener(CONTEXT_RECOVERY_EVENT,invalidate);};
  },[]);
  // Child unmount cleanup removes unsaved-work guards before account recovery navigates.
  useEffect(()=>{if(destination)window.location.replace(new URL(destination,window.location.href).href);},[destination]);
  return destination?null:children;
}
