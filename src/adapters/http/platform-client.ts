import { INVITE_MESSAGES, PLATFORM_MESSAGES } from '../../domain/platform.ts';
import type { InviteLinkRefusal, InvitePreview, IssuedInvite, PasswordRefusal, PlatformPerson, PlatformRefusal } from '../../domain/platform.ts';
import type { UsageReport } from '../../domain/platform-usage.ts';
import { ok, refuse } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { InviteAccepted, InviteDesk, PlatformConsole, PlatformDirectory, PlatformLogPage, PlatformOperator, Restored } from '../../ports/platform.ts';
import {createReporterTransport} from './reporter-client.ts';
import {createHttpWorkspaceAdministration} from './workspace-management.ts';
import {createHttpMemberViewing} from './member-view.ts';

/**
 * The connected console and invite page: `/api/reporter/platform` and `/api/reporter/invites`.
 * Refusals arrive as `{ error, message }` with the domain code; anything unexpected is
 * `unavailable`. Signed out, the console goes to the sign-in page.
 */

const PLATFORM_CODES = new Set<string>(Object.keys(PLATFORM_MESSAGES));
const INVITE_CODES = new Set<string>([...Object.keys(INVITE_MESSAGES), 'password_short', 'password_long', 'password_mismatch']);

type Body = Record<string, unknown>;

async function request(path: string, body?: unknown): Promise<{ status: number; value: Body } | null> {
  try {
    const response = await fetch(`/api/reporter/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: { 'x-reporter-client': 'local', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    const value = (await response.json().catch(() => ({}))) as Body;
    return { status: response.status, value };
  } catch {
    return null;
  }
}

async function inviteCall<T, C extends string>(path: string, body?: unknown): Promise<Result<T, C>> {
  const answer = await request(`invites/${path}`, body);
  if (!answer) return refuse('unavailable' as C, INVITE_MESSAGES.unavailable);
  if (answer.status < 300) return ok(answer.value as T);
  const code = typeof answer.value.error === 'string' && INVITE_CODES.has(answer.value.error) ? answer.value.error : 'unavailable';
  return refuse(code as C, typeof answer.value.message === 'string' ? answer.value.message : INVITE_MESSAGES.unavailable);
}

export function createHttpPlatform() {
  const listeners = new Set<() => void>();
  const http=createReporterTransport(undefined,{requireAccount:true});
  let binding:Promise<PlatformOperator>|undefined;
  let accountId:string|undefined;
  const ready=async()=>{await(binding??=http.request<PlatformOperator>('/platform/operator').then(operator=>{http.bindAccount(operator.id);accountId=operator.id;return operator;}).catch(error=>{binding=undefined;throw error;}));};
  async function platformCall<T>(path:string,body?:unknown):Promise<Result<T,PlatformRefusal>>{
    try{await ready();return ok(await http.request<T>(`/platform/${path}`,body));}
    catch(error){const value=error as {code?:string;message?:string};
      if(value.code==='auth_required'&&typeof window!=='undefined')window.location.replace('/auth/sign-in');
      const code=value.code&&PLATFORM_CODES.has(value.code)?value.code as PlatformRefusal:'unavailable';return refuse(code,value.message||PLATFORM_MESSAGES[code]);}
  }
  const notify=()=>{for(const listener of [...listeners])listener();};
  async function write<T>(path: string, body: unknown): Promise<Result<T, PlatformRefusal>> {
    const result = await platformCall<T>(path, body);
    if (result.ok) notify();
    return result;
  }
  const person = (id: string) => `people/${encodeURIComponent(id)}`;
  const query=(options:object={})=>new URLSearchParams(Object.entries(options).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])).toString();

  const platform: PlatformConsole = {
    mode: 'connected',
    operator: () => platformCall<PlatformOperator>('operator'),
    directory: options => platformCall<PlatformDirectory>(`directory?${query(options)}`),
    usage: (period,filter) => platformCall<UsageReport>(`usage?${query({period,...filter})}`),
    log: (limit,options) => platformCall<PlatformLogPage>(`log?${query({limit,...options})}`),
    accountStatus:(id,suspended)=>write<PlatformPerson>(`${person(id)}/account-status`,{suspended}),
    invite: (input) => write<IssuedInvite>('invites', input),
    renewInvite: (id) => write<IssuedInvite>(`${person(id)}/renew-invite`, {}),
    approve: (id, roles) => write<PlatformPerson>(`${person(id)}/approve`, { roles }),
    setRoles: (id, roles) => write<PlatformPerson>(`${person(id)}/roles`, { roles }),
    suspend: (id) => write<PlatformPerson>(`${person(id)}/suspend`, {}),
    restore: (id) => write<Restored>(`${person(id)}/restore`, {}),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };

  const invites: InviteDesk = {
    preview: (token) => inviteCall<InvitePreview, 'invalid_link' | 'unavailable'>(encodeURIComponent(token)),
    accept: (token, password, confirmation) =>
      inviteCall<InviteAccepted, PasswordRefusal | InviteLinkRefusal>(`${encodeURIComponent(token)}/accept`, { password, confirmation }),
  };

  return { console: platform, invites,workspaces:createHttpWorkspaceAdministration({transport:http,ready,notify}),memberViewing:createHttpMemberViewing(http,ready,()=>accountId),dispose:()=>{http.dispose();listeners.clear();} };
}
