import { runWithWorkerContext } from '../../src/server/worker-context.ts';

/** Explicit ownership for fixtures that manually exercise one worker SQL command. */
export function withPilotWorker<T>(operation:()=>T):T {
  return runWithWorkerContext({tenant:'10000000-0000-0000-0000-000000000001',portal:'10000000-0000-0000-0000-000000000101'},operation);
}
