import type {IsoDateTime,PersonId,WorkspaceId} from './ids.ts';
import type {Role} from './workspace.ts';
import {workspaceAddress,workspaceHref} from './workspace-address.ts';

/** A context identifier grants no access without its owning, verified platform operator. */
export type MemberView = {
  id:string;
  readOnly:true;
  workspace:{id:WorkspaceId;name:string;slug:string};
  person:{id:PersonId;name:string;email:string;avatarUrl?:string;roles:Role[]};
  operator:{id:PersonId;name:string;email:string;avatarUrl?:string};
  expiresAt:IsoDateTime;
  /** The database clock supplies the initial lifetime, independent of the browser's wall clock. */
  remainingMs:number;
};
export type MemberViewExit='exit'|'workspace_changed'|'logout'|'account_changed';
export const MEMBER_VIEW_PAGE_HEADER='x-reporter-page-view';
export function memberViewId(value:string):string|undefined{
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():undefined;
}
/** Global destinations and another client's address explicitly leave the viewing context. */
export function memberViewHref(slug:string|undefined,viewId:string|undefined,href:string):string{
  const scoped=workspaceHref(slug,href);
  if(viewId===undefined||!slug||!scoped.startsWith('/')||scoped.startsWith('//'))return scoped;
  const url=new URL(scoped,'https://reporter.invalid');
  if(workspaceAddress(url.pathname)?.slug!==slug)return scoped;
  url.searchParams.set('view',viewId);
  return url.pathname+url.search+url.hash;
}
/** Private app photos always use this app's checked view route, including old absolute references. */
export function memberViewImageSource(viewId:string,source:string|undefined):string|undefined{
  if(!source)return source;
  try{
    const url=new URL(source,'https://reporter.invalid');
    if(!url.pathname.startsWith('/api/reporter/'))return source;
    url.searchParams.set('_view',viewId);
    return url.pathname+url.search;
  }catch{return source;}
}
