import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '../domain/workspace.ts';
import type { WorkspaceStatus } from '../domain/workspace-management.ts';
import type {MemberView} from '../domain/member-view.ts';
import { localContext } from './config.ts';
import { reporterDeploymentMode } from './deployment.ts';

export type ReporterRequestContext = {
  tenant: string;
  portal: string;
  actor: string;
  workspaceName: string;
  workspaceSlug: string;
  name: string;
  email: string;
  image?: string;
  roles: Role[];
  addressed?: true;
  administrative?: boolean;
  workspaceStatus?: WorkspaceStatus;
  /** The actor above is the effective reader. This immutable context retains the actual operator. */
  view?:MemberView;
};

const contexts = new AsyncLocalStorage<ReporterRequestContext>();

export function runWithReporterContext<T>(context: ReporterRequestContext, operation: () => T): T {
  return contexts.run(context, operation);
}

export function currentReporterContext(): ReporterRequestContext {
  const context = contexts.getStore();
  if (context) return context;
  if (reporterDeploymentMode() === 'local') return { ...localContext,roles: [...localContext.roles] };
  throw new Error('AUTH_CONTEXT_MISSING');
}
