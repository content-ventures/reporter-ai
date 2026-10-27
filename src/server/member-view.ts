import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {memberViewId,type MemberView} from '../domain/member-view.ts';
import {accountAvatarSource} from '../domain/profile.ts';
import {reporterIdentity} from './auth.ts';
import {cloudPortalId,localContext} from './config.ts';
import {pool} from './database.ts';
import {reporterDeploymentMode} from './deployment.ts';
import {FlowError} from './errors.ts';
import type {ReporterRequestContext} from './request-context.ts';

export type MemberViewDeps={guardLocal:(request:Request)=>void;identify?:typeof reporterIdentity;requestId?:string};
type Identity=Awaited<ReturnType<typeof reporterIdentity>>;
type Resolved={accountId:string|null;context?:ReporterRequestContext;view?:MemberView;error?:string};

/** The query variant is required for ordinary image elements, which cannot attach a header. */
export function requestedMemberView(request:Request):string|undefined{
  const query=new URL(request.url).searchParams,header=request.headers.get('x-reporter-view');
  const values=query.getAll('_view');
  if(header===null&&values.length===0)return undefined;
  const id=memberViewId(header??values[0]??'');
  if(!id||values.length>1||values.length===1&&memberViewId(values[0])!==id)throw new FlowError('MEMBER_VIEW_UNAVAILABLE',403);
  return id;
}

async function identityOf(request:Request,deps:MemberViewDeps):Promise<Identity>{
  if(reporterDeploymentMode()==='local'){deps.guardLocal(request);return null;}
  if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==new URL(request.url).origin)throw new FlowError('ORIGIN_DENIED',403);
  const identity=await(deps.identify??reporterIdentity)();
  if(!identity)throw new FlowError('AUTH_REQUIRED',401);
  if(!identity.emailVerified)throw new FlowError('EMAIL_NOT_VERIFIED',403);
  return identity;
}
function sessionHash(identity:Identity):string{
  const session=reporterDeploymentMode()==='local'?`local:${localContext.actor}`:identity?.sessionId;
  if(!session)throw new FlowError('AUTH_REQUIRED',401);
  return createHash('sha256').update(session).digest('hex');
}
export async function memberViewSession(request:Request,deps:MemberViewDeps):Promise<string>{
  return sessionHash(await identityOf(request,deps));
}
async function viewDatabase<T>(requestId:string,session:string,operation:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool('runtime').connect(),local=reporterDeploymentMode()==='local';
  try{
    await client.query('BEGIN');
    await client.query("SELECT 1 AS applied FROM (SELECT set_config('app.access_mode',$1,true),set_config('app.user_id',$2,true),set_config('app.request_id',$3,true),set_config('app.correlation_id',$3,true),set_config('app.auth_session',$4,true),set_config('statement_timeout','10s',true)) settings",
      [local?'platform':'member_view',local?localContext.actor:'',requestId,session]);
    const value=await operation(client);await client.query('COMMIT');return value;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
async function lookup(client:PoolClient,id:string,slug:string|null,identity:Identity):Promise<Resolved>{
  return(await client.query('SELECT public.reporter_member_view_context($1,$2,$3,$4,$5) AS value',
    [identity?.subject??null,identity?.email??null,identity?.emailVerified??false,id,slug])).rows[0].value;
}
function boundAccount(request:Request,value:Resolved){
  const expected=request.headers.get('x-reporter-account');
  if(expected&&expected!==value.accountId)throw new FlowError('ACCOUNT_CONTEXT_CHANGED',409);
}
export function memberViewPhotos(view:MemberView):MemberView{
  const pilot=reporterDeploymentMode()==='local'?localContext.portal:cloudPortalId();
  return{...view,person:{...view.person,avatarUrl:accountAvatarSource(view.person.id,view.person.avatarUrl,pilot)},
    operator:{...view.operator,avatarUrl:accountAvatarSource(view.operator.id,view.operator.avatarUrl,pilot)}};
}
export async function resolveMemberView(request:Request,id:string,slug:string|null,deps:MemberViewDeps):Promise<ReporterRequestContext>{
  const identity=await identityOf(request,deps);
  const value=await viewDatabase(deps.requestId??randomUUID(),sessionHash(identity),client=>lookup(client,id,slug,identity));
  boundAccount(request,value);
  // The transaction has committed any expiry/revocation audit before the refusal is raised.
  if(value.error||!value.context||!value.view)throw new FlowError(value.error==='MEMBER_VIEW_ENDED'?'MEMBER_VIEW_ENDED':'MEMBER_VIEW_UNAVAILABLE',410);
  const view=memberViewPhotos(value.view),context=value.context;
  return{...context,image:accountAvatarSource(context.actor,typeof context.image==='string'?context.image:undefined,
    reporterDeploymentMode()==='local'?localContext.portal:cloudPortalId()),view};
}

/** Ending an owned support context requires the real login, including after its operator role is revoked. */
export async function endMemberView(request:Request,id:string,readJson:(request:Request)=>Promise<unknown>,deps:MemberViewDeps):Promise<Response>{
  if(request.method!=='POST'||!memberViewId(id))throw new FlowError('NOT_FOUND',404);
  const identity=await identityOf(request,deps);
  const {reason}=z.object({reason:z.enum(['exit','workspace_changed','logout','account_changed']).default('exit')}).strict().parse(await readJson(request));
  const value=await viewDatabase(deps.requestId??randomUUID(),sessionHash(identity),async client=>{
    const current=await lookup(client,id,null,identity);boundAccount(request,current);
    return(await client.query('SELECT public.reporter_member_view_end($1,$2,$3,$4,$5) AS value',
      [identity?.subject??null,identity?.email??null,identity?.emailVerified??false,id,reason])).rows[0].value as boolean;
  });
  if(!value)throw new FlowError('MEMBER_VIEW_UNAVAILABLE',403);
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

/** Neither a warm administrator asset cache nor an intermediary may extend this view's lifetime. */
export function memberViewResponse(response:Response):Response{
  const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');
  headers.set('Vary','Cookie, x-reporter-view');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
