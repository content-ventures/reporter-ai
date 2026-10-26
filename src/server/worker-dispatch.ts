import 'server-only';
import { transaction } from './database.ts';
import { currentWorkerContext, runWithWorkerContext } from './worker-context.ts';
import type { WorkerContext } from './worker-context.ts';

export type WorkKind = 'any' | 'remote' | 'outbox' | 'editorial' | 'images' | 'fact_check' | 'news' | 'search' | 'translation';

/** One leased client per turn. Nested processors inherit the persisted dispatch context. */
export async function withWorkspaceWork<T>(kind: WorkKind, owner: string, signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>): Promise<T | false> {
  if (signal.aborted) return false;
  if (currentWorkerContext()) return operation(signal);
  const context = await transaction('worker', async client => (await client.query(
    'SELECT public.reporter_worker_next($1,$2) AS value',[owner,kind])).rows[0]?.value as WorkerContext | null);
  if (!context?.dispatch) return false;
  const { dispatch } = context;
  const controller = new AbortController(), combined = AbortSignal.any([signal,controller.signal]);
  let renewing: Promise<void> | undefined;
  return runWithWorkerContext(context, async () => {
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = transaction('worker', async client => (await client.query(
        'SELECT public.reporter_worker_dispatch_renew($1,$2,$3) AS value',[context.portal,dispatch.owner,dispatch.fence])).rows[0]?.value === true)
        .then(valid => { if (!valid) controller.abort('workspace_lease_lost'); })
        .catch(() => controller.abort('workspace_lease_lost')).finally(() => { renewing = undefined; });
    },20_000);
    timer.unref?.();
    try { return await operation(combined); }
    finally {
      clearInterval(timer); await renewing;
      await transaction('worker', client => client.query('SELECT public.reporter_worker_dispatch_release($1,$2,$3)',
        [context.portal,dispatch.owner,dispatch.fence]));
    }
  });
}
