import "server-only";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { attachDatabasePool } from '@vercel/functions';
import type { Role } from '../domain/workspace.ts';
import type { WorkspaceStatus } from '../domain/workspace-management.ts';
import { accountAvatarSource } from '../domain/profile.ts';
import { assertLocalMode, cloudDatabaseUrl, cloudPortalId, databasePassword, localDatabasePort, localContext } from "./config";
import { reporterDeploymentMode } from './deployment.ts';
import { currentReporterContext, type ReporterRequestContext } from './request-context.ts';
import { currentWorkerContext } from './worker-context.ts';
import {FlowError} from './errors.ts';

const globalPools = globalThis as typeof globalThis & { reporterPools?: Partial<Record<"runtime" | "worker", Pool>> };
export function pool(role: "runtime" | "worker") {
  globalPools.reporterPools ??= {};
  const existing = globalPools.reporterPools[role];
  if (existing) return existing;
  const local = reporterDeploymentMode() === 'local';
  if (local) assertLocalMode();
  const created = local ? new Pool({
      host: "127.0.0.1", port: localDatabasePort(), database: "reporter_ai_local", user: "reporter_" + role,
      password: databasePassword(role), max: role === "worker" ? 3 : 5,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: "reporter-ai-" + role,
    }) : new Pool({
      connectionString: cloudDatabaseUrl(role),max: role === 'worker' ? 3 : 5,
      connectionTimeoutMillis: 8000,idleTimeoutMillis: 30000,application_name: 'reporter-ai-'+role,
    });
  if (!local && process.env.VERCEL === '1') attachDatabasePool(created);
  globalPools.reporterPools[role] = created;
  return created;
}

const ROLES = new Set<Role>(['admin','editor','approver','creative_reviewer']);
type ContextRow = {
  tenant_id: string;portal_id: string;user_id: string;workspace_name: string;workspace_slug: string;user_name: string;user_email: string;user_image: string | null;roles: string[];
  administrative?: boolean; workspace_status?: WorkspaceStatus;
};
function contextOf(row: ContextRow | undefined): ReporterRequestContext | null {
  if (!row) return null;
  return { tenant: row.tenant_id,portal: row.portal_id,actor: row.user_id,workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,name: row.user_name,email: row.user_email,
    image: accountAvatarSource(row.user_id,row.user_image ?? undefined,reporterDeploymentMode() === 'cloud' ? cloudPortalId() : localContext.portal),
    roles: row.roles.filter((role): role is Role => ROLES.has(role as Role)),
    ...(row.administrative !== undefined ? { addressed: true as const, administrative: row.administrative, workspaceStatus: row.workspace_status } : {}) };
}

export async function resolveReporterContext(identity: { subject: string; email: string; name: string; image?: string; emailVerified: boolean }, slug?: string): Promise<ReporterRequestContext | null> {
  if (reporterDeploymentMode() !== 'cloud' || !identity.email || !identity.emailVerified) return null;
  const { rows } = await pool('runtime').query<ContextRow>(slug ? 'SELECT * FROM public.reporter_workspace_context($1,$2,$3,$4,$5,$6)' : 'SELECT * FROM public.reporter_session_context($1,$2,$3,$4,$5,$6)',[
    identity.subject,identity.email,identity.name,identity.image ?? null,identity.emailVerified,slug ?? cloudPortalId(),
  ]);
  return contextOf(rows[0]);
}

export async function localWorkspaceQuery<T>(sql: string, values: unknown[]): Promise<T[]> {
  assertLocalMode();
  const client = await pool('runtime').connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.access_mode','platform',true),set_config('app.user_id','00000000-0000-0000-0000-000000000031',true)");
    const { rows } = await client.query(sql,values);
    await client.query('COMMIT');
    return rows as T[];
  } catch(error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}
export async function resolveLocalWorkspaceContext(slug: string): Promise<ReporterRequestContext | null> {
  const rows = await localWorkspaceQuery<ContextRow>('SELECT * FROM public.reporter_local_workspace_context($1)',[slug]);
  return contextOf(rows[0]);
}

/** A member the server acts for without a session (the Drive folder intake), found by email. */
export async function resolveServiceContext(email: string, workspaceId = cloudPortalId()): Promise<ReporterRequestContext | null> {
  if (reporterDeploymentMode() !== 'cloud' || !email.trim()) return null;
  const { rows } = await pool('runtime').query<ContextRow>('SELECT * FROM public.reporter_service_context($1,$2)',[email.trim(),workspaceId]);
  return contextOf(rows[0]);
}

export async function resolveDriveBinding(id:string|undefined,tokenHash:string):Promise<{context:ReporterRequestContext;derivation:string}|null> {
  const query=id?'SELECT public.reporter_drive_binding($1,$2) AS value':'SELECT public.reporter_drive_legacy_binding($1,$2) AS value';
  const {rows}=await pool('runtime').query<{value:{context:ContextRow;derivation:string}|null}>(query,[id??cloudPortalId(),tokenHash]);
  const value=rows[0]?.value,context=contextOf(value?.context);
  return context && value ? {context,derivation:value.derivation} : null;
}
export async function driveRetryContext(transcriptId:string):Promise<ReporterRequestContext|null> {
  return transaction('runtime',async client=>contextOf((await client.query('SELECT public.reporter_drive_retry_context($1) AS value',[transcriptId])).rows[0]?.value));
}

export async function transaction<T>(role: "runtime" | "worker", operation: (client: PoolClient) => Promise<T>, requestId: string = randomUUID()): Promise<T> {
  const client = await pool(role).connect();
  try {
    const context=role==='runtime'?currentReporterContext():undefined;
    await client.query(context?.view?'BEGIN READ ONLY':'BEGIN');
    // One round trip sets the timeout and the context; it answers with one integer, not the
    // values it was sent, because every byte PostgreSQL returns is billed transfer.
    if (role === "runtime") {
      const context = currentReporterContext();
      await client.query("SELECT 1 AS applied FROM (SELECT set_config('statement_timeout','10s',true),set_config('app.access_mode',$5,true),set_config('app.module_key','reporter_ai',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true),set_config('app.correlation_id',$4,true)) settings",
        [context.tenant, context.portal, context.actor, requestId, context.administrative ? 'platform_workspace' : 'user']);
      if(context.view){
        await client.query("SELECT 1 AS applied FROM (SELECT set_config('app.member_view',$1,true),set_config('app.real_user_id',$2,true),set_config('app.auth_session',$3,true)) settings",[context.view.id,context.view.operator.id,context.viewSession??'']);
        const valid=(await client.query('SELECT public.reporter_member_view_valid($1,$2,$3,$4) AS valid',
          [context.view.id,context.view.operator.id,context.portal,context.actor])).rows[0]?.valid;
        if(valid!==true)throw new FlowError('MEMBER_VIEW_ENDED',410);
      }
    } else {
      const context = currentWorkerContext();
      await client.query("SELECT 1 AS applied FROM (SELECT set_config('statement_timeout','10s',true),set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)) settings",
        [context?.tenant ?? '',context?.portal ?? '',context?.actor ?? '',requestId]);
    }
    const result = await operation(client);
    await client.query("COMMIT"); return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {}); throw error;
  } finally { client.release(); }
}

/** Immediate work is due on the clock that claims it, independently of app/worker host skew. */
export async function databaseNow(client:PoolClient):Promise<number> {
  return Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now')).rows[0].now);
}

export async function command<T extends string | number = string>(name: string, values: unknown[], requestId?: string): Promise<T> {
  const allowed = new Set(["reporter_create","reporter_edit_article","reporter_submit_article","reporter_review_article","reporter_edit_carousel","reporter_ready_carousel","reporter_retry"]);
  if (!allowed.has(name)) throw new Error("UNKNOWN_COMMAND");
  return transaction("runtime", async client => {
    const placeholders = values.map((_, i) => "$" + (i + 1)).join(",");
    const { rows } = await client.query<{ result: T }>("SELECT public." + name + "(" + placeholders + ") AS result", values);
    return rows[0].result;
  }, requestId);
}
