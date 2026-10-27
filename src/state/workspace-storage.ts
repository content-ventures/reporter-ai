'use client';
import {useRuntime} from './use-runtime';
import {useSession} from './use-queries';
/** Browser conveniences never move a client's records into another account or workspace. */
export function useWorkspaceStorageKey(base:string):string|undefined{
  const {runtime}=useRuntime(),session=useSession().data;
  if(runtime?.mode==='simulated')return base;
  const account=runtime?.navigation?.accountId??session?.current?.id;
  const view=runtime?.navigation?.view?.id;
  return runtime&&session&&account?`${base}:${encodeURIComponent(session.workspace.id)}:${encodeURIComponent(account)}${view?`:view:${view}`:''}`:undefined;
}
