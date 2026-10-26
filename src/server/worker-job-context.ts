import 'server-only';
import type { EditorialJob } from '../ports/connected-workspace.ts';
import { bindWorkerJob, currentWorkerContext, requireWorkerContext, runWithWorkerContext } from './worker-context.ts';
import type { WorkerContext } from './worker-context.ts';
import { FlowError } from './errors.ts';

/** Preserve an existing dispatch's fence; a callback cannot change its persisted owner. */
export function withRegisteredWorkerContext<T>(context: WorkerContext, operation: () => T): T {
  const current=currentWorkerContext();
  if (!current) return runWithWorkerContext(context,operation);
  if (current.tenant!==context.tenant || current.portal!==context.portal || current.actor && current.actor!==context.actor)
    throw new FlowError('WORKER_CONTEXT_CHANGED',409);
  if (context.actor) current.actor=context.actor;
  return operation();
}

export function bindEditorialJob(job: EditorialJob, actor: string): void {
  const context=requireWorkerContext(), captured=job.context;
  // Only the existing pilot can contain pre-workspace jobs. New clients require capture at enqueue.
  const legacyPilot=['10000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000101'].includes(context.portal);
  if (!captured && !legacyPilot || captured && (captured.tenant!==context.tenant || captured.workspace!==context.portal || captured.actor!==actor))
    throw new FlowError('JOB_CONTEXT_MISMATCH',422);
  bindWorkerJob(actor,'editorial',job.meta.runId);
}
