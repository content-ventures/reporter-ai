import type {PersonId,WorkspaceId} from '../domain/ids.ts';
import type {MemberView,MemberViewExit} from '../domain/member-view.ts';
import type {Result} from '../domain/result.ts';

/** Starts an audited read-only view; it never signs in as, or writes for, the viewed person. */
export interface MemberViewing {
  start(workspaceId:WorkspaceId,personId:PersonId):Promise<Result<MemberView,'restricted'|'unavailable'>>;
  end(viewId:string,reason?:MemberViewExit):Promise<Result<true,'restricted'|'unavailable'>>;
}
