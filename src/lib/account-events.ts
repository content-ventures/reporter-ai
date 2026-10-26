'use client';
export const ACCOUNT_REVISION_KEY='reporter:account-revision';
const EVENT='reporter:account-change';
/** Carries no account data, credentials or workspace preference. */
export function announceAccountChange(){
  try{window.localStorage.setItem(ACCOUNT_REVISION_KEY,crypto.randomUUID());}catch{/* The current tab still closes its context. */}
  window.dispatchEvent(new Event(EVENT));
}
export function subscribeAccountChange(listener:()=>void){
  const storage=(event:StorageEvent)=>{if(event.key===ACCOUNT_REVISION_KEY)listener();};
  window.addEventListener('storage',storage);window.addEventListener(EVENT,listener);
  return()=>{window.removeEventListener('storage',storage);window.removeEventListener(EVENT,listener);};
}
