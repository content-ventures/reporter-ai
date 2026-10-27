import 'server-only';
import type {WorkspaceActivation,WorkspaceRollout} from '../domain/workspace-management.ts';
import {limitWorkspaceRollout} from '../domain/workspace-management.ts';
import {pool} from './database.ts';
import {workspaceRollout} from './workspace-rollout.ts';

export function activationPolicy(value:Omit<WorkspaceActivation,'effective'>):WorkspaceActivation{
  return {...value,effective:limitWorkspaceRollout(workspaceRollout(),value.mode)};
}
/** Once per request, then captured in the immutable context and its polling stamp. */
export async function effectiveWorkspaceRollout():Promise<WorkspaceRollout>{
  const ceiling=workspaceRollout();if(ceiling==='off')return 'off';
  const value=(await pool('runtime').query<{mode:WorkspaceRollout}>("SELECT public.reporter_workspace_activation()->>'mode' AS mode")).rows[0]?.mode;
  // Missing or malformed activation state never enables a context.
  return value==='admin'||value==='all'?limitWorkspaceRollout(ceiling,value):'off';
}
