'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {subscribeAccountChange} from '@/lib/account-events';
/** A login or logout in another tab removes private views before opening the current account. */
export function AccountBoundary({children}:{children:ReactNode}){
  const [invalidated,setInvalidated]=useState(false);
  useEffect(()=>{
    if(process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES==='true')return;
    return subscribeAccountChange(()=>{
      if(window.location.pathname.startsWith('/auth/'))return;
      setInvalidated(true);window.location.replace(new URL('/workspaces?entry=1',window.location.href).href);
    });
  },[]);
  return invalidated?null:children;
}
