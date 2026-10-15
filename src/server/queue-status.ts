import 'server-only';
import type { PoolClient } from 'pg';

export type QueueStatus = { pending: boolean; stalled: boolean };
export const IDLE_QUEUE: QueueStatus = Object.freeze({ pending: false, stalled: false });

/** Claimable work for this scope, and whether it has waited more than 90 s for a worker. */
export async function queueStatus(client: PoolClient, scope: 'editorial' | `transcript:${string}`): Promise<QueueStatus> {
  const value = (await client.query('SELECT public.reporter_queue_status($1) AS value', [scope])).rows[0]?.value;
  return { pending: value?.pending === true, stalled: value?.stalled === true };
}
