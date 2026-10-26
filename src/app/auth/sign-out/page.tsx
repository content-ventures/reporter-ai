'use client';
import {useEffect,useRef,useState} from 'react';
import {ErrorState,PageStack,SkeletonText} from '@content-ventures/design-system/v3';
import {authClient} from '@/lib/auth-client';
/** A guarded destination lets unsaved-work confirmation finish the intended sign-out. */
export default function SignOutPage(){
  const started=useRef(false),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{if(started.current)return;started.current=true;
    void authClient.signOut().then(result=>{if(result.error)throw result.error;window.location.replace('/auth/sign-in');}).catch(()=>{started.current=false;setError(true);});
  },[attempt]);
  return<PageStack>{error?<ErrorState heading="h1" title="Não foi possível encerrar a sessão" onRetry={()=>{setError(false);setAttempt(value=>value+1);}}/>:<SkeletonText lines={2}/>}</PageStack>;
}
