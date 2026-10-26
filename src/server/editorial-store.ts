import 'server-only';
import type { PoolClient } from 'pg';
import { PART_KINDS, type EditorialChanges, type EditorialRows, type ItemKind, type LoadedScope, type PartKind } from '../ports/editorial-rows.ts';

/**
 * What one transaction reads. Productions are named directly, through an entity they own
 * (piece, version, review, run…), or through a source they use; their parts, sources, runs
 * and items come with them unless the scope narrows it. Naming `runs` or `partIds` loads
 * exactly those; `pipelines: false` skips the pipeline snapshots.
 */
export type EditorialScope = {
  productions?: 'all' | string[];
  entities?: string[];
  sourceUsers?: string[];
  parts?: PartKind[];
  partIds?: string[];
  sources?: 'all' | 'none' | string[];
  runs?: 'none' | string[];
  recentRuns?: number;
  events?: 'active' | string[];
  items?: Partial<Record<ItemKind, 'all' | 'production' | string[]>>;
  history?: boolean;
  workspaceLock?: boolean;
  receipt?: string;
  jobs?: boolean;
  pipelines?: false;
  /** Client render packs are loaded only for reads or commands that use carousel checks. */
  templates?: boolean;
};

// Identity and workspace membership are always needed; production items follow their production.
const DEFAULT_ITEMS: Partial<Record<ItemKind, 'all' | 'production'>> = { person: 'all', member: 'all', image_asset: 'production', feedback: 'production' };

/** Everything: rare commands and library reads that genuinely span the workspace. */
export const FULL_SCOPE: EditorialScope = { productions: 'all', sources: 'all', history: true,templates:true,
  items: { person: 'all', member: 'all', image_asset: 'all', feedback: 'all', citation: 'all', fact_check: 'all', library_image: 'all', banner: 'all' } };

export function loadedScope(scope: EditorialScope): LoadedScope {
  const items = { ...DEFAULT_ITEMS, ...scope.items };
  return { parts: scope.parts ?? PART_KINDS, ...(scope.partIds ? { partIds: scope.partIds } : {}), items: Object.keys(items) as ItemKind[],
    history: Boolean(scope.history) };
}

export type StoredReceipt = { hash: string; result: unknown; projection?: 'pipeline' };

export async function loadEditorialRows(client: PoolClient, scope: EditorialScope, write: boolean) {
  const value = (await client.query('SELECT public.reporter_ed_load($1::jsonb) AS value', [JSON.stringify({
    write, productions: scope.productions, entities: scope.entities, source_users: scope.sourceUsers, parts: scope.parts, part_ids: scope.partIds,
    sources: scope.sources, runs: scope.runs, recent_runs: scope.recentRuns, events: scope.events,
    items: { ...DEFAULT_ITEMS, ...scope.items }, history: scope.history, workspace_lock: scope.workspaceLock,
    receipt: scope.receipt, jobs: scope.jobs, pipelines: scope.pipelines,
  })])).rows[0].value;
  const rows: EditorialRows = { seq: Number(value.seq ?? 0), workspace: value.workspace ?? null, productions: value.productions,
    parts: value.parts, sources: value.sources, runs: value.runs, events: value.events, items: value.items, pipelines: value.pipelines };
  return { rows, receipt: (value.receipt?.result ?? null) as StoredReceipt | null };
}

/** The transaction's last call: changed rows and the command receipt, stamped with the next number. */
export async function commitEditorialChanges(client: PoolClient, changes: EditorialChanges, receipt?: { requestId: string; value: StoredReceipt }) {
  const payload = { ...changes, ...(receipt ? { receipt: { requestId: receipt.requestId, hash: receipt.value.hash, result: receipt.value } } : {}) };
  return Number((await client.query('SELECT public.reporter_ed_commit($1::jsonb) AS seq', [JSON.stringify(payload)])).rows[0].seq);
}
