import {refuse,ok} from '../../domain/result.ts';
import {WORKSPACE_MESSAGES} from '../../domain/workspace-management.ts';
import type {WorkspaceDirectory,WorkspaceAccessPage} from '../../ports/workspace-management.ts';
import type {ReporterTransport} from './reporter-client.ts';
import {managementSearch} from './workspace-management.ts';

export function createHttpWorkspaceDirectory(http:ReporterTransport,ready?:()=>Promise<void>):WorkspaceDirectory{
  return{async accessible(options){
    try{
      await ready?.();const page=await http.request<WorkspaceAccessPage>(`/workspaces?${managementSearch(options)}`);
      if(!Array.isArray(page.items)||!Number.isInteger(page.total)||page.total<0||page.items.length>100||page.items.length>0&&!page.account?.id)throw new Error('Resposta de workspaces inválida.');
      if(page.account?.id)http.bindAccount(page.account.id);
      return ok(page);
    }catch(error){const value=error as {status?:number;code?:string;message?:string};
      const code=value.status===401||value.status===403||value.code==='ACCOUNT_CONTEXT_CHANGED'?'restricted' as const:'unavailable' as const;
      return refuse(code,value.message||WORKSPACE_MESSAGES[code]);}
  }};
}
