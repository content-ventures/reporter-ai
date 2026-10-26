import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { logEvent } from './errors.ts';

/** Execution ownership comes from persisted work, independently of a browser's current page. */
export type WorkerContext = {
  tenant: string;
  portal: string;
  actor?: string;
  service?: 'legacy_automation';
  job?: { kind: string; id: string };
  dispatch?: { owner: string; fence: string };
};
const contexts = new AsyncLocalStorage<WorkerContext>();
const guid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function runWithWorkerContext<T>(context: WorkerContext,operation: () => T): T {
  if (!guid.test(context.tenant) || !guid.test(context.portal) || context.actor && !guid.test(context.actor)) throw new Error('INVALID_WORKER_CONTEXT');
  return contexts.run({...context,job:context.job?{...context.job}:undefined,dispatch:context.dispatch?{...context.dispatch}:undefined},operation);
}
export function currentWorkerContext(): WorkerContext | undefined { return contexts.getStore(); }
export function requireWorkerContext(): WorkerContext {
  const context = currentWorkerContext();
  if (!context) throw new Error('WORKER_CONTEXT_MISSING');
  return context;
}
/** A dispatch executes one claimed task; its initiating identity cannot change midway. */
export function bindWorkerJob(actor: string,kind: string,id: string): void {
  const context = requireWorkerContext();
  if (!guid.test(actor) || context.actor && context.actor !== actor || context.job && (context.job.kind !== kind || context.job.id !== id)) throw new Error('WORKER_CONTEXT_CHANGED');
  context.actor = actor;
  context.job = {kind,id};
}

export function logWorkerEvent(component:string,message:string,attributes:Parameters<typeof logEvent>[2]={}):void {
  const context=currentWorkerContext();
  logEvent(component,message,{...attributes,...(context?{workspace_id:context.portal,actor_id:context.actor,service_actor:context.service}: {})});
}
