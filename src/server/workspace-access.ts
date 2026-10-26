import 'server-only';
import { reporterIdentity } from './auth.ts';
import { localWorkspaceQuery, pool } from './database.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { FlowError } from './errors.ts';
import { workspaceRollout } from './workspace-rollout.ts';
import type { WorkspaceAccessPage } from '../ports/workspace-management.ts';
import {accountAvatarSource} from '../domain/profile.ts';
import {cloudPortalId,localContext} from './config.ts';

export async function workspaceDirectory(request: Request, deps: { guardLocal(request: Request): void; identify?: typeof reporterIdentity }): Promise<WorkspaceAccessPage> {
  const rollout = workspaceRollout();
  if (rollout === 'off') throw new FlowError('WORKSPACES_DISABLED',403);
  const query = new URL(request.url).searchParams;
  const search = (query.get('search') ?? '').slice(0,100);
  const limit = Math.min(100,Math.max(1,Math.trunc(Number(query.get('limit')) || 50)));
  const offset = Math.min(1000000,Math.max(0,Math.trunc(Number(query.get('offset')) || 0)));
  let value: WorkspaceAccessPage;
  if (reporterDeploymentMode() === 'local') {
    deps.guardLocal(request);
    value = (await localWorkspaceQuery<{ value: WorkspaceAccessPage }>('SELECT public.reporter_local_workspace_directory($1,$2,$3) AS value',[search,limit,offset]))[0].value;
  } else {
    const identity = await (deps.identify ?? reporterIdentity)();
    if (!identity) throw new FlowError('AUTH_REQUIRED',401);
    if (!identity.emailVerified) throw new FlowError('EMAIL_NOT_VERIFIED',403);
    const { rows } = await pool('runtime').query<{ value: WorkspaceAccessPage }>('SELECT public.reporter_workspace_directory($1,$2,$3,$4,$5,$6,$7,$8) AS value',
      [identity.subject,identity.email,identity.name,identity.image ?? null,identity.emailVerified,search,limit,offset]);
    value = rows[0].value;
  }
  if (rollout === 'admin' && !value.administrative) throw new FlowError('WORKSPACES_RESTRICTED',403);
  const expected=request.headers.get('x-reporter-account');
  if(expected&&value.account?.id!==expected)throw new FlowError('ACCOUNT_CONTEXT_CHANGED',409);
  if(value.account?.avatarUrl)value.account.avatarUrl=accountAvatarSource(value.account.id,value.account.avatarUrl,reporterDeploymentMode()==='local'?localContext.portal:cloudPortalId());
  return value;
}
