import {workspaceSlug} from './workspace-address.ts';
export type WorkspacePreference={workspaceId:string;slug:string};
/** A destination hint is owned by an account and must still be authorized by the server. */
export const workspacePreferenceKey=(accountId:string)=>`reporter:last-workspace:${encodeURIComponent(accountId)}`;
export function parseWorkspacePreference(raw:string|null):WorkspacePreference|undefined{
  try{const value=JSON.parse(raw??'null');
    if(!value||typeof value.workspaceId!=='string'||!value.workspaceId||value.workspaceId.length>100||typeof value.slug!=='string'||!workspaceSlug(value.slug))return;
    return{workspaceId:value.workspaceId,slug:value.slug};
  }catch{return undefined;}
}
