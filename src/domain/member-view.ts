import type {IsoDateTime,PersonId,WorkspaceId} from './ids.ts';
import type {Role} from './workspace.ts';

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
