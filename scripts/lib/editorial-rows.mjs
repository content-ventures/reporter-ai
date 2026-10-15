/** Owner-side reads and resets of a portal's editorial rows, for acceptance tooling only. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const portalId = (portal) => {
  if (!UUID.test(portal)) throw new Error("A portal UUID is required.");
  return portal;
};

// Children before parents: events and runs, then parts, then their productions.
export const EDITORIAL_ROW_TABLES = Object.freeze([
  "reporter_ed_run_events", "reporter_ed_runs", "reporter_ed_parts", "reporter_ed_productions", "reporter_ed_sources",
  "reporter_ed_items", "reporter_ed_receipts", "reporter_ed_pipelines", "reporter_ed_workspace",
]);

/**
 * The active pipeline definition. A database that has not run migration 016 yet still keeps
 * it in the editorial document, so that is read instead.
 */
export async function activePipelineDefinition(client, portal) {
  const id = portalId(portal);
  // A table that does not exist yet cannot even be named in the same statement.
  const rowsReady = (await client.query("SELECT to_regclass('public.reporter_ed_sync') IS NOT NULL AS ready")).rows[0]?.ready;
  const migrated = rowsReady && (await client.query(
    "SELECT EXISTS(SELECT 1 FROM public.reporter_ed_sync WHERE portal_id=$1 AND migrated_at IS NOT NULL) AS migrated", [id])).rows[0]?.migrated;
  const { rows } = await client.query(migrated
    ? `SELECT p.doc->'definition' AS definition FROM public.reporter_ed_workspace w JOIN public.reporter_ed_pipelines p
         ON p.portal_id=w.portal_id AND p.hash=w.doc->>'pipelineHash' WHERE w.portal_id=$1`
    : "SELECT checkpoint->'pipeline'->'definition' AS definition FROM public.reporter_editorial_workspaces WHERE portal_id=$1", [id]);
  return rows[0]?.definition ?? null;
}

/** Empties one portal's editorial rows; browsers holding an older change number reload a snapshot. */
export async function resetEditorialRows(client, portal) {
  const id = portalId(portal);
  for (const table of EDITORIAL_ROW_TABLES) await client.query(`DELETE FROM public.${table} WHERE portal_id=$1`, [id]);
  await client.query("UPDATE public.reporter_ed_sync SET floor_seq=seq WHERE portal_id=$1", [id]);
}
