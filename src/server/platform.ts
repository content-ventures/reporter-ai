import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connection } from 'next/server';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { buildUsageReport, DEFAULT_USAGE_PERIOD, USAGE_PERIODS, usageWindow, type UsageFacts, type UsagePeriod } from '../domain/platform-usage.ts';
import {
  INVITE_MESSAGES,
  INVITE_TOKEN,
  INVITE_TTL_DAYS,
  PLATFORM_MESSAGES,
  validateInvite,
  validateNewPassword,
  validateRoles,
  type InviteLinkRefusal,
  type PlatformRefusal,
} from '../domain/platform.ts';
import { ROLES, type Role } from '../domain/workspace.ts';
import { WORKSPACE_MESSAGES, validateWorkspace } from '../domain/workspace-management.ts';
import { accountAvatarSource } from '../domain/profile.ts';
import { reporterIdentity } from './auth.ts';
import { cloudPortalId, localContext } from './config.ts';
import { pool,transaction } from './database.ts';
import {currentReporterContext} from './request-context.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { FlowError, logEvent } from './errors.ts';
import {readWorkspaceTemplates,saveWorkspaceTemplates,uploadWorkspaceBrand} from './template-settings.ts';
import {previewConfigurationCopy,applyConfigurationCopy} from './configuration-copy.ts';
import {memberViewPhotos,memberViewSession} from './member-view.ts';
import type {MemberView} from '../domain/member-view.ts';
import {activationPolicy,effectiveWorkspaceRollout} from './workspace-activation.ts';
import type {WorkspaceActivation} from '../domain/workspace-management.ts';

/**
 * Console da plataforma and the access link over HTTP.
 *
 * `/api/reporter/platform/*` answers only a signed-in person who holds the platform role; it does
 * not need a workspace membership. Each request runs one transaction with
 * `app.access_mode='platform'` and the operator's id, and every SQL function checks the role again.
 *
 * `/api/reporter/invites/<token>` is public: the token is the credential. Accepting it defines the
 * password with Neon Auth (sign-up; or a sign-in check when the account already exists), then the
 * database binds the account, marks the e-mail verified and closes the link. No e-mail is sent.
 */

type Identity = Awaited<ReturnType<typeof reporterIdentity>>;

export type PlatformDeps = {
  readJson: (request: Request) => Promise<unknown>;
  guardLocal: (request: Request) => void;
  identify?: () => Promise<Identity>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A console refusal: the domain code and its pt-BR message. */
class Refused extends Error {
  readonly refusal: string;
  readonly status: number;
  readonly text: string;
  constructor(refusal: string, text: string, status: number) {
    super(refusal);
    this.refusal = refusal;
    this.text = text;
    this.status = status;
  }
}

const PLATFORM_STATUS: Readonly<Record<PlatformRefusal, number>> = {
  invalid_name: 422, invalid_email: 422, invalid_role: 422, invalid_workspace: 422, no_roles: 422,
  restricted: 403, self: 403, not_found: 404, email_taken: 409, invalid_state: 409, unavailable: 503,
};

function platformRefusal(code: PlatformRefusal): Refused {
  return new Refused(code, PLATFORM_MESSAGES[code], PLATFORM_STATUS[code]);
}

const INVITE_STATUS: Readonly<Record<InviteLinkRefusal, number>> = { invalid_link: 404, expired: 410, used: 409, wrong_password: 401, unavailable: 503 };

function inviteRefusal(code: InviteLinkRefusal): Refused {
  return new Refused(code, INVITE_MESSAGES[code], INVITE_STATUS[code]);
}

/** SQL raises `P0001` with an upper-case code; anything else is not a refusal. */
const SQL_REFUSALS: Readonly<Record<string, PlatformRefusal | InviteLinkRefusal>> = {
  INVALID_NAME: 'invalid_name', INVALID_EMAIL: 'invalid_email', INVALID_ROLE: 'invalid_role', INVALID_WORKSPACE: 'invalid_workspace',
  EMAIL_TAKEN: 'email_taken', SELF: 'self', NO_ROLES: 'no_roles', INVALID_STATE: 'invalid_state', NOT_FOUND: 'not_found',
  INVALID_LINK: 'invalid_link', USED: 'used', EXPIRED: 'expired',
  AMBIGUOUS_MEMBERSHIP: 'invalid_state',
};

function translate(error: unknown): unknown {
  if (!error || typeof error !== 'object') return error;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if(code==='40P01'||code==='40001')return new Refused('conflict',WORKSPACE_MESSAGES.conflict,409);
  if (code === '42501') return platformRefusal('restricted');
  if (code === 'P0001' && typeof message === 'string') {
    const workspaceCode = ({ INVALID_SLUG: 'invalid_slug', SLUG_TAKEN: 'slug_taken', CONFLICT: 'conflict' } as const)[message as 'INVALID_SLUG' | 'SLUG_TAKEN' | 'CONFLICT'];
    if (workspaceCode) return new Refused(workspaceCode, WORKSPACE_MESSAGES[workspaceCode], workspaceCode === 'invalid_slug' ? 422 : 409);
  }
  if (code === 'P0001' && typeof message === 'string' && SQL_REFUSALS[message]) {
    const refusal = SQL_REFUSALS[message];
    return refusal in INVITE_STATUS ? inviteRefusal(refusal as InviteLinkRefusal) : platformRefusal(refusal as PlatformRefusal);
  }
  return error;
}

function accountPhotos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(accountPhotos);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string,unknown> = Object.fromEntries(Object.entries(value).map(([key,item])=>[key,accountPhotos(item)]));
  const accountId=typeof result.personId==='string'?result.personId:result.id;
  if (typeof accountId === 'string' && typeof result.avatarUrl === 'string') result.avatarUrl = accountAvatarSource(accountId,result.avatarUrl,defaultPortal());
  return result;
}
function reply(value: unknown, status = 200): Response {
  return Response.json(accountPhotos(value), { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function run<T>(mode: 'platform' | 'invite', actor: string | null, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool('runtime').connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT 1 AS applied FROM (SELECT set_config('statement_timeout','10s',true),set_config('app.access_mode',$1,true),set_config('app.user_id',$2,true),set_config('app.request_id',$3,true),set_config('app.correlation_id',$3,true)) settings",
      [mode, actor ?? '', randomUUID()]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw translate(error);
  } finally { client.release(); }
}

async function call<T>(client: PoolClient, sql: string, values: unknown[] = []): Promise<T> {
  return (await client.query<{ value: T }>(sql, values)).rows[0]?.value as T;
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest('hex') };
}

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** The signed-in operator's `core.users` id; local mode is the synthetic operator (checked in SQL). */
async function operatorOf(request: Request, deps: PlatformDeps): Promise<string> {
  const bound=request.headers.get('x-reporter-account');
  const checked=(actor:string)=>{if(bound&&bound!==actor)throw new Refused('conflict','A conta desta aba mudou. Reabra o console antes de continuar.',409);return actor;};
  if (reporterDeploymentMode() === 'local') {
    deps.guardLocal(request);
    return checked(localContext.actor);
  }
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD'].includes(request.method) && origin !== url.origin) throw new FlowError('ORIGIN_DENIED', 403);
  const identity = await (deps.identify ?? reporterIdentity)();
  if (!identity) throw new FlowError('AUTH_REQUIRED', 401);
  if (!identity.emailVerified) throw platformRefusal('restricted');
  const { rows } = await pool('runtime').query<{ user_id: string }>('SELECT user_id FROM public.reporter_platform_context($1,$2)', [identity.subject, identity.email]);
  if (!rows[0]) throw platformRefusal('restricted');
  return checked(rows[0].user_id);
}

const rolesSchema = z.object({ roles: z.array(z.enum(ROLES as readonly [Role, ...Role[]])).max(8) }).strict();
const inviteSchema = z.object({ name: z.string().max(400), email: z.string().max(400), role: z.string().max(40), workspaceId: z.string().max(80) }).strict();
const workspaceSchema = z.object({ name: z.string().max(400), slug: z.string().max(100) }).strict();
const workspaceChangeSchema = z.object({ name: z.string().trim().min(2).max(80), status: z.enum(['draft', 'active', 'archived']), revision: z.number().int().positive() }).strict();
const membershipSchema = z.object({ revision: z.number().int().positive(), roles: z.array(z.enum(ROLES)).min(1).max(8).optional(), status: z.enum(['active', 'suspended']).optional() }).strict()
  .refine(value => Boolean(value.roles) !== Boolean(value.status));

function personId(raw: string | undefined): string {
  if (!raw || !UUID.test(raw)) throw platformRefusal('not_found');
  return raw;
}

function roles(input: unknown): Role[] {
  const parsed = rolesSchema.safeParse(input);
  if (!parsed.success) throw platformRefusal('no_roles');
  const valid = validateRoles(parsed.data.roles);
  if (!valid.ok) throw platformRefusal('no_roles');
  return valid.value;
}

function defaultPortal(): string {
  return reporterDeploymentMode() === 'cloud' ? cloudPortalId() : localContext.portal;
}

export async function handlePlatform(request: Request, path: string[], deps: PlatformDeps): Promise<Response> {
  try {
    const operator = await operatorOf(request, deps);
    const platform = <T>(operation: (client: PoolClient) => Promise<T>) => run('platform', operator, operation);
    const [head, id, action] = path;

    if(head==='member-views'&&path.length===1&&request.method==='POST'){
      if(await effectiveWorkspaceRollout()==='off')throw new Refused('restricted','A navegação entre workspaces ainda não está habilitada.',403);
      const input=z.object({workspaceId:z.string().regex(UUID),personId:z.string().regex(UUID)}).strict().safeParse(await deps.readJson(request));
      if(!input.success)throw platformRefusal('invalid_workspace');
      const session=await memberViewSession(request,deps);
      const view=await platform(async client=>{await client.query("SELECT set_config('app.auth_session',$1,true)",[session]);
        return call<MemberView>(client,'SELECT public.reporter_member_view_start($1,$2) AS value',[input.data.workspaceId,input.data.personId]);});
      return reply(memberViewPhotos(view),201);
    }

    if(head==='workspace-activation'&&path.length===1){
      if(request.method==='GET')return reply(activationPolicy(await platform(client=>call<Omit<WorkspaceActivation,'effective'>>(client,'SELECT public.reporter_workspace_activation() AS value'))));
      if(request.method==='POST'){
        const parsed=z.object({mode:z.enum(['off','admin','all']),revision:z.number().int().positive()}).strict().safeParse(await deps.readJson(request));
        if(!parsed.success)throw platformRefusal('invalid_state');
        return reply(activationPolicy(await platform(client=>call<Omit<WorkspaceActivation,'effective'>>(client,'SELECT public.reporter_workspace_activation_save($1,$2) AS value',[parsed.data.mode,parsed.data.revision]))));
      }
      throw platformRefusal('not_found');
    }
    if (request.method === 'GET') {
      if(head==='workspaces'&&path.length===2)return reply(await platform(client=>call(client,'SELECT public.reporter_workspace_get($1::uuid) AS value',[personId(id)])));
      if(head==='workspaces'&&path.length===3&&action==='team')return reply(await teamPage(request,personId(id),platform));
      if (head === 'workspaces' && path.length === 1) {
        const params = new URL(request.url).searchParams;
        return reply(await platform(client => call(client, 'SELECT public.reporter_workspace_list($1,$2,$3) AS value',
          [(params.get('search') ?? '').slice(0,100), Math.min(100,Math.max(1,Math.trunc(Number(params.get('limit')) || 50))), Math.min(1000000,Math.max(0,Math.trunc(Number(params.get('offset')) || 0)))])));
      }
      if (head === 'workspaces' && path.length === 3 && action === 'members') {
        return reply(await platform(client => call(client, 'SELECT public.reporter_workspace_members($1::uuid) AS value', [personId(id)])));
      }
      if (head==='workspaces' && path.length===3 && action==='integrations')
        return reply(await platform(client=>call(client,'SELECT public.reporter_integration_list($1::uuid) AS value',[personId(id)])));
      if(head==='workspaces'&&path.length===3&&action==='processing')
        return reply(await platform(client=>call(client,'SELECT public.reporter_processing_view($1::uuid) AS value',[personId(id)])));
      if(head==='workspaces'&&path.length===3&&action==='templates')
        return reply(await platform(client=>readWorkspaceTemplates(client,personId(id))));
      if (path.length === 1 && head === 'operator') return reply(await platform(client => call(client, 'SELECT public.reporter_platform_operator() AS value')));
      if(path.length===1&&head==='people-labels'){
        const ids=(new URL(request.url).searchParams.get('ids')??'').split(',').filter(Boolean);
        if(ids.length>100||ids.some(id=>!UUID.test(id)))throw new Refused('invalid_state','Informe até 100 pessoas válidas.',422);
        return reply(await platform(client=>call(client,'SELECT public.reporter_platform_people_labels($1::uuid[]) AS value',[[...new Set(ids)]])));
      }
      if (path.length === 1 && head === 'directory') {
        const query=new URL(request.url).searchParams;
        return reply(await platform(client=>call(client,'SELECT public.reporter_platform_directory_page($1,$2,$3,$4,$5,$6) AS value',[
          (query.get('search')??'').slice(0,100),query.get('status')||null,query.get('workspaceId')?personId(query.get('workspaceId')!):null,
          query.get('personId')?.slice(0,300)||null,Math.min(100,Math.max(1,Number(query.get('limit'))||50)),Math.min(1000000,Math.max(0,Number(query.get('offset'))||0))])));
      }
      if (path.length === 1 && head === 'log') {
        const query=new URL(request.url).searchParams;
        const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 50));
        return reply(await platform(client => call(client, 'SELECT public.reporter_platform_log_page($1,$2,$3,$4) AS value',
          [limit,Math.min(1000000,Math.max(0,Number(query.get('offset'))||0)),query.get('workspaceId')?personId(query.get('workspaceId')!):null,query.get('personId')?personId(query.get('personId')!):null])));
      }
      if (path.length === 1 && head === 'usage') {
        const query=new URL(request.url).searchParams,asked = Number(query.get('period'));
        const period: UsagePeriod = (USAGE_PERIODS as readonly number[]).includes(asked) ? asked as UsagePeriod : DEFAULT_USAGE_PERIOD;
        const now = new Date().toISOString();
        const facts = await platform(client => call<UsageFacts>(client, 'SELECT public.reporter_platform_usage($1::date,$2::uuid,$3::uuid) AS value',
          [usageWindow(period, now).previousFrom,query.get('workspaceId')?personId(query.get('workspaceId')!):null,query.get('personId')?personId(query.get('personId')!):null]));
        return reply(buildUsageReport(facts, period, now));
      }
      throw platformRefusal('not_found');
    }
    if (request.method !== 'POST') throw platformRefusal('not_found');

    if(head==='configuration-copy'&&path.length===2){
      const body=await deps.readJson(request);
      if(id==='preview')return reply(await platform(client=>previewConfigurationCopy(client,operator,body)));
      if(id==='apply')return reply(await platform(client=>applyConfigurationCopy(client,operator,body)));
    }

    if(head==='workspaces'&&path.length===3&&action==='templates'){
      const body=await deps.readJson(request);return reply(await platform(client=>saveWorkspaceTemplates(client,personId(id),body)));
    }
    if(head==='workspaces'&&path.length===3&&action==='logo')return reply(await uploadWorkspaceBrand(request,personId(id),platform),201);

    if(head==='workspaces'&&path.length===3&&action==='processing'){
      const parsed=z.object({revision:z.number().int().positive(),dailyLimit:z.number().int().min(1).max(10000).nullable()}).strict().safeParse(await deps.readJson(request));
      if(!parsed.success)throw platformRefusal('invalid_state');
      return reply(await platform(client=>call(client,'SELECT public.reporter_processing_save($1::uuid,$2,$3) AS value',[personId(id),parsed.data.revision,parsed.data.dailyLimit])));
    }

    if(head==='workspaces'&&path.length===3&&action==='integrations'){
      const parsed=z.object({ownerId:z.uuid(),enabled:z.boolean(),revision:z.number().int().min(0),rotate:z.boolean().optional()}).strict().safeParse(await deps.readJson(request));
      if(!parsed.success)throw platformRefusal('invalid_state');
      const creating=parsed.data.revision===0;
      const legacy=creating&&id===cloudPortalId()?process.env.REPORTER_DRIVE_SECRET?.trim():undefined;
      const secret=creating||parsed.data.rotate?legacy&&legacy.length>=32?legacy:randomBytes(32).toString('base64url'):undefined;
      const derivation=creating?legacy&&legacy.length>=32?legacy:randomBytes(32).toString('base64url'):null;
      const value=await platform(client=>call<{id:string}>(client,'SELECT public.reporter_integration_save($1::uuid,$2::uuid,$3,$4,$5,$6) AS value',
        [personId(id),parsed.data.ownerId,parsed.data.enabled,parsed.data.revision,secret?createHash('sha256').update(secret).digest('hex'):null,derivation]));
      return reply({...value,...(secret?{credential:{token:secret,endpoint:new URL(`/api/reporter/drive/${value.id}/sync`,request.url).href}}:{})},creating?201:200);
    }

    if (head === 'workspaces' && path.length === 1) {
      const parsed = workspaceSchema.safeParse(await deps.readJson(request));
      if (!parsed.success) throw platformRefusal('invalid_name');
      const checked = validateWorkspace(parsed.data);
      if (!checked.ok) throw new Refused(checked.refusal.code, checked.refusal.message, 422);
      return reply(await platform(client => call(client, 'SELECT public.reporter_workspace_create($1,$2) AS value', [checked.value.name, checked.value.slug])), 201);
    }
    if (head === 'workspaces' && path.length === 3 && action === 'update') {
      const parsed = workspaceChangeSchema.safeParse(await deps.readJson(request));
      if (!parsed.success) throw platformRefusal('invalid_state');
      return reply(await platform(client => call(client, 'SELECT public.reporter_workspace_update($1::uuid,$2,$3,$4) AS value',
        [personId(id), parsed.data.name, parsed.data.status, parsed.data.revision])));
    }
    if (head === 'workspaces' && path.length === 4 && action === 'members') {
      const parsed = membershipSchema.safeParse(await deps.readJson(request));
      if (!parsed.success) throw platformRefusal('invalid_state');
      return reply(await platform(client => call(client, 'SELECT public.reporter_membership_change($1::uuid,$2::uuid,$3,$4::text[],$5) AS value',
        [personId(id), personId(path[3]), parsed.data.revision, parsed.data.roles ?? null, parsed.data.status ?? null])));
    }
    if (head === 'workspaces' && path.length === 5 && action === 'members' && path[4] === 'renew-invite') {
      const parsed = z.object({ revision: z.number().int().positive() }).strict().safeParse(await deps.readJson(request));
      if (!parsed.success) throw platformRefusal('invalid_state');
      const { token, hash } = newToken();
      const value = await platform(client => call<{ person: unknown; expiresAt: string }>(client,
        'SELECT public.reporter_membership_renew($1::uuid,$2::uuid,$3,$4,$5) AS value',
        [personId(id), personId(path[3]), parsed.data.revision, hash, INVITE_TTL_DAYS]));
      return reply({ ...value, token });
    }
    if (head === 'workspaces' && path.length === 5 && action === 'signups' && path[4] === 'approve') {
      const subject = path[3];
      if (!subject?.startsWith('auth:') || subject.length > 300) throw platformRefusal('not_found');
      const chosen = roles(await deps.readJson(request));
      return reply(await platform(client => call(client, 'SELECT public.reporter_platform_approve($1,$2::text[],$3::uuid) AS value',
        [subject.slice(5), chosen, personId(id)])));
    }

    if (path.length === 1 && head === 'invites') {
      const input = inviteSchema.safeParse(await deps.readJson(request));
      if (!input.success) throw platformRefusal('invalid_name');
      const valid = validateInvite({ ...input.data, role: input.data.role as Role });
      if (!valid.ok) throw platformRefusal(valid.refusal.code);
      const { token, hash } = newToken();
      const value = await platform(client => call<{ person: unknown; expiresAt: string }>(client,
        'SELECT public.reporter_platform_invite($1,$2,$3,$4::uuid,$5,$6) AS value',
        [valid.value.name, valid.value.email, valid.value.role, personId(valid.value.workspaceId), hash, INVITE_TTL_DAYS]));
      return reply({ ...value, token });
    }
    if (path.length === 3 && head === 'people') {
      if (action === 'account-status') {
        const parsed = z.object({ suspended: z.boolean() }).strict().safeParse(await deps.readJson(request));
        if (!parsed.success) throw platformRefusal('invalid_state');
        return reply(await platform(client => call(client, 'SELECT public.reporter_account_status($1::uuid,$2) AS value', [personId(id), parsed.data.suspended])));
      }
      if (action === 'approve') {
        if (!id?.startsWith('auth:') || id.length > 300) throw platformRefusal('not_found');
        const chosen = roles(await deps.readJson(request));
        return reply(await platform(client => call(client, 'SELECT public.reporter_platform_approve($1,$2::text[],$3::uuid) AS value', [id.slice(5), chosen, defaultPortal()])));
      }
      const target = personId(id);
      if (action === 'roles') {
        const chosen = roles(await deps.readJson(request));
        return reply(await platform(client => call(client, 'SELECT public.reporter_platform_set_roles($1::uuid,$2::text[]) AS value', [target, chosen])));
      }
      if (action === 'suspend') return reply(await platform(client => call(client, 'SELECT public.reporter_platform_suspend($1::uuid) AS value', [target])));
      if (action === 'renew-invite') {
        const { token, hash } = newToken();
        const value = await platform(client => call<{ person: unknown; expiresAt: string }>(client,
          'SELECT public.reporter_platform_renew_invite($1::uuid,$2,$3) AS value', [target, hash, INVITE_TTL_DAYS]));
        return reply({ ...value, token });
      }
      if (action === 'restore') {
        const { token, hash } = newToken();
        const value = await platform(client => call<{ person: { id: string }; expiresAt?: string }>(client,
          'SELECT public.reporter_platform_restore($1::uuid,$2,$3) AS value', [target, hash, INVITE_TTL_DAYS]));
        return reply(value.expiresAt ? { person: value.person, invite: { person: value.person, token, expiresAt: value.expiresAt } } : { person: value.person });
      }
    }
    throw platformRefusal('not_found');
  } catch (error) {
    return failure(error, 'platform');
  }
}

type TeamExecutor=<T>(operation:(client:PoolClient)=>Promise<T>)=>Promise<T>;
function teamPage(request:Request,workspace:string,execute:TeamExecutor){
  const params=new URL(request.url).searchParams;
  return execute(client=>call(client,'SELECT public.reporter_team_page($1::uuid,$2,$3,$4) AS value',[workspace,
    (params.get('search')??'').slice(0,100),Math.min(100,Math.max(1,Number(params.get('limit'))||20)),Math.min(1000000,Math.max(0,Number(params.get('offset'))||0))]));
}
/** An actual workspace administrator manages only this client's relationships. */
export async function handleWorkspaceTeam(request:Request,path:string[],deps:Pick<PlatformDeps,'readJson'>):Promise<Response>{
  try{
    const workspace=currentReporterContext().portal,execute:TeamExecutor=operation=>transaction('runtime',operation);
    if(request.method==='GET'&&path.join('/')==='workspace')return reply(await execute(client=>call(client,'SELECT public.reporter_workspace_get($1) AS value',[workspace])));
    if(request.method==='GET'&&path.length===0)return reply(await teamPage(request,workspace,execute));
    if(request.method!=='POST')throw platformRefusal('not_found');
    const body=await deps.readJson(request);
    if(path.join('/')==='invites'){
      const parsed=inviteSchema.omit({workspaceId:true}).safeParse(body);
      if(!parsed.success)throw platformRefusal('invalid_state');
      const valid=validateInvite({...parsed.data,role:parsed.data.role as Role,workspaceId:workspace});
      if(!valid.ok)throw platformRefusal(valid.refusal.code);
      const {token,hash}=newToken();
      const value=await execute(client=>call<Record<string,unknown>>(client,'SELECT public.reporter_platform_invite($1,$2,$3,$4::uuid,$5,$6) AS value',
        [valid.value.name,valid.value.email,valid.value.role,workspace,hash,INVITE_TTL_DAYS]));
      return reply({...value,token},201);
    }
    if(path.length===2&&path[1]==='renew-invite'){
      const parsed=z.object({revision:z.number().int().positive()}).strict().safeParse(body);if(!parsed.success)throw platformRefusal('invalid_state');
      const {token,hash}=newToken();
      const value=await execute(client=>call<Record<string,unknown>>(client,'SELECT public.reporter_membership_renew($1::uuid,$2::uuid,$3,$4,$5) AS value',
        [workspace,personId(path[0]),parsed.data.revision,hash,INVITE_TTL_DAYS]));return reply({...value,token});
    }
    if(path.length===1){
      const parsed=membershipSchema.safeParse(body);if(!parsed.success)throw platformRefusal('invalid_state');
      return reply(await execute(client=>call(client,'SELECT public.reporter_membership_change($1::uuid,$2::uuid,$3,$4::text[],$5) AS value',
        [workspace,personId(path[0]),parsed.data.revision,parsed.data.roles??null,parsed.data.status??null])));
    }
    throw platformRefusal('not_found');
  }catch(error){return failure(translate(error),'platform');}
}

function failure(error: unknown, component: 'platform' | 'invites'): Response {
  if (error instanceof Refused) return reply({ error: error.refusal, message: error.text }, error.status);
  if(error instanceof FlowError&&(/^(TEMPLATE_|BRAND_IMAGE_|COPY_)/.test(error.code)||error.code==='FORBIDDEN'))
    return reply({error:error.code,message:error.reason??PLATFORM_MESSAGES.restricted},error.status);
  if (error instanceof FlowError && ['AUTH_REQUIRED', 'ORIGIN_DENIED', 'LOCAL_ACCESS_ONLY', 'CLIENT_HEADER_REQUIRED'].includes(error.code)) {
    return reply({ error: error.code === 'AUTH_REQUIRED' ? 'auth_required' : 'restricted', message: PLATFORM_MESSAGES.restricted }, error.status);
  }
  logEvent(component, 'request_failed', { error_code: error instanceof FlowError ? error.code : 'INTERNAL_ERROR' });
  return component === 'platform'
    ? reply({ error: 'unavailable', message: PLATFORM_MESSAGES.unavailable }, 503)
    : reply({ error: 'unavailable', message: INVITE_MESSAGES.unavailable }, 503);
}

type Preview = { name: string; email: string; state: string; hasAccount: boolean };

/** Neon Auth's own endpoints, called by the server with the app's origin; the session they open is discarded. */
async function neonAuth(path: 'sign-up/email' | 'sign-in/email', origin: string, body: Record<string, string>): Promise<{ status: number; subject?: string; code?: string }> {
  const base = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!base) throw inviteRefusal('unavailable');
  const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000), cache: 'no-store',
  });
  const value = await response.json().catch(() => ({})) as { user?: { id?: unknown }; code?: unknown };
  return { status: response.status, subject: typeof value.user?.id === 'string' ? value.user.id : undefined, code: typeof value.code === 'string' ? value.code : undefined };
}

/** The Neon Auth account of this e-mail with this password: created now, or the existing one checked. */
async function defineAccount(origin: string, preview: Preview, password: string): Promise<string> {
  if (!preview.hasAccount) {
    const created = await neonAuth('sign-up/email', origin, { email: preview.email, password, name: preview.name });
    if (created.status < 300 && created.subject) return created.subject;
    if (created.status !== 422 && created.code !== 'USER_ALREADY_EXISTS') throw inviteRefusal('unavailable');
  }
  const signed = await neonAuth('sign-in/email', origin, { email: preview.email, password });
  if (signed.status < 300 && signed.subject) return signed.subject;
  if (signed.status === 401 || signed.status === 403) throw inviteRefusal('wrong_password');
  throw inviteRefusal('unavailable');
}

const acceptSchema = z.object({ password: z.string().max(400), confirmation: z.string().max(400) }).strict();

export async function handleInvites(request: Request, path: string[], deps: PlatformDeps): Promise<Response> {
  try {
    const [token, action] = path;
    if (!token || !INVITE_TOKEN.test(token) || path.length > 2) throw inviteRefusal('invalid_link');
    const hash = tokenHash(token);
    const local = reporterDeploymentMode() === 'local';
    if (local) deps.guardLocal(request);
    const preview = () => run('invite', null, client => call<Preview | null>(client, 'SELECT public.reporter_invite_preview($1) AS value', [hash]));

    if (request.method === 'GET' && path.length === 1) {
      const value = await preview();
      if (!value) throw inviteRefusal('invalid_link');
      return reply(value);
    }
    if (request.method !== 'POST' || action !== 'accept') throw inviteRefusal('invalid_link');
    const origin = new URL(request.url).origin;
    if (!local && request.headers.get('origin') !== origin) throw new FlowError('ORIGIN_DENIED', 403);
    const input = acceptSchema.safeParse(await deps.readJson(request));
    if (!input.success) throw inviteRefusal('invalid_link');
    const valid = validateNewPassword(input.data.password, input.data.confirmation);
    if (!valid.ok) return reply({ error: valid.refusal.code, message: valid.refusal.message }, 422);
    const current = await preview();
    if (!current || current.state === 'revoked') throw inviteRefusal('invalid_link');
    if (current.state === 'expired') throw inviteRefusal('expired');
    // Local development has no Neon Auth: the link only releases the synthetic account.
    const subject = local ? await run('invite', null, client => call<string | null>(client, 'SELECT public.reporter_invite_local_subject($1) AS value', [hash]))
      : await defineAccount(origin, current, valid.value);
    if (!subject) throw inviteRefusal('invalid_link');
    const accepted = await run('invite', null, client => call<{ email: string }>(client, 'SELECT public.reporter_invite_accept($1,$2) AS value', [hash, subject]));
    return reply({ email: accepted.email, signIn: !local });
  } catch (error) {
    return failure(error, 'invites');
  }
}

/**
 * Whether the console's pages render for this request. Signed-in people without the platform
 * role get a 404: the console does not reveal that it exists. Local and demo builds answer from
 * their own checks (the synthetic operator, the seeded demo).
 */
export async function platformAccess(): Promise<boolean> {
  // Per request, never prerendered: the answer depends on who is signed in.
  await connection();
  if (process.env.NEXT_PUBLIC_REPORTER_E2E_FIXTURES === 'true' || reporterDeploymentMode() !== 'cloud') return true;
  const identity = await reporterIdentity();
  if (!identity?.emailVerified) return false;
  const { rows } = await pool('runtime').query('SELECT user_id FROM public.reporter_platform_context($1,$2)', [identity.subject, identity.email]);
  return rows.length > 0;
}
