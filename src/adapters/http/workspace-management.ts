import {WORKSPACE_MESSAGES} from '../../domain/workspace-management.ts';
import type {WorkspaceRefusal} from '../../domain/workspace-management.ts';
import {ok,refuse} from '../../domain/result.ts';
import type {WorkspaceAdministration,WorkspaceResult,WorkspaceSearch} from '../../ports/workspace-management.ts';
import type {ReporterTransport} from './reporter-client.ts';

type Transport=Pick<ReporterTransport,'request'|'upload'>;
export function managementSearch(options:WorkspaceSearch={}){
  const query=new URLSearchParams();
  if(options.search)query.set('search',options.search);
  query.set('limit',String(options.limit??20));query.set('offset',String(options.offset??0));return query.toString();
}
/** Both adapters capture a transport lifetime; a scoped one cannot choose a different client. */
export function createHttpWorkspaceAdministration(options:{transport:Transport;ready?:()=>Promise<void>;scope?:()=>string;readOnly?:()=>boolean;notify?:()=>void}):WorkspaceAdministration{
  const {transport}=options,listeners=new Set<()=>void>(),global=!options.scope;
  const signal=()=>{options.notify?.();for(const listener of listeners)listener();};
  const restricted=<T>():Promise<WorkspaceResult<T>>=>Promise.resolve(refuse('restricted',WORKSPACE_MESSAGES.restricted));
  async function call<T>(path:string,body?:unknown,file?:Blob,id?:string):Promise<WorkspaceResult<T>>{
    try{await options.ready?.();if(options.readOnly?.()&&(body!==undefined||file))return refuse('restricted',WORKSPACE_MESSAGES.restricted);if(id&&options.scope&&options.scope()!==id)return refuse('restricted',WORKSPACE_MESSAGES.restricted);
      const value=file?await transport.upload<T>(path,file):await transport.request<T>(path,body);if(body!==undefined||file)signal();return ok(value);}
    catch(error){
      const value=error as {code?:string;message?:string;status?:number};
      const known=value.code&&value.code in WORKSPACE_MESSAGES?value.code as WorkspaceRefusal:undefined;
      const code=known??(value.status===409?'conflict':value.status===403?'restricted':value.status===404?'not_found':value.status===422?'invalid_state':'unavailable');
      return refuse(code,value.message||WORKSPACE_MESSAGES[code]);
    }
  }
  function scoped<T>(id:string,action:string,body?:unknown,file?:Blob):Promise<WorkspaceResult<T>>{
    return call(global?`/platform/workspaces/${encodeURIComponent(id)}${action}`:action,body,file,id);
  }
  const memberPath=(input:{personId:string})=>encodeURIComponent(input.personId);
  return{
    global,get readOnly(){return options.readOnly?.()??false;},
    activation:()=>global?call('/platform/workspace-activation'):restricted(),
    setActivation:input=>global?call('/platform/workspace-activation',input):restricted(),
    get:id=>scoped(id,global?'':'/team/workspace'),
    list:query=>global?call(`/platform/workspaces?${managementSearch(query)}`):restricted(),
    create:input=>global?call('/platform/workspaces',input):restricted(),
    update:({workspaceId,...body})=>global?scoped(workspaceId,'/update',body):restricted(),
    members:(id,query)=>scoped(id,`/team?${managementSearch(query)}`),
    invite:input=>global?call('/platform/invites',input):scoped(input.workspaceId,'/team/invites',{name:input.name,email:input.email,role:input.role}),
    renewInvite:input=>scoped(input.workspaceId,`${global?'/members':'/team'}/${memberPath(input)}/renew-invite`,{revision:input.revision}),
    setRoles:input=>scoped(input.workspaceId,`${global?'/members':'/team'}/${memberPath(input)}`,{revision:input.revision,roles:input.roles}),
    setStatus:input=>scoped(input.workspaceId,`${global?'/members':'/team'}/${memberPath(input)}`,{revision:input.revision,status:input.status}),
    integrations:id=>global?scoped(id,'/integrations'):restricted(),
    saveIntegration:({workspaceId,...body})=>global?scoped(workspaceId,'/integrations',body):restricted(),
    processing:id=>global?scoped(id,'/processing'):restricted(),
    setProcessing:({workspaceId,...body})=>global?scoped(workspaceId,'/processing',body):restricted(),
    templates:id=>scoped(id,'/templates'),
    saveTemplates:({workspaceId,...body})=>scoped(workspaceId,'/templates',body),
    uploadLogo:(id,file)=>scoped(id,global?'/logo':'/templates/logo',undefined,file),
    previewCopy:input=>global?call('/platform/configuration-copy/preview',input):restricted(),
    applyCopy:token=>global?call('/platform/configuration-copy/apply',{token}):restricted(),
    approveSignup:input=>global?scoped(input.workspaceId,`/signups/${memberPath(input)}/approve`,{roles:input.roles}):restricted(),
    subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  };
}
