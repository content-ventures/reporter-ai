import assert from "node:assert/strict";
import { test } from "node:test";
import { EDITORIAL_ROW_TABLES, activePipelineDefinition, resetEditorialRows } from "./editorial-rows.mjs";

const PORTAL = "10000000-0000-0000-0000-000000000101";
function fakeClient(answers) {
  const queries = [];
  return { queries, async query(sql, values = []) {
    queries.push({ sql, values });
    const found = answers.find(([pattern]) => pattern.test(sql));
    return { rows: found ? [found[1]] : [] };
  } };
}

test("the active pipeline comes from rows once the portal is imported, else from the document", async () => {
  const imported = fakeClient([[/to_regclass/, { ready: true }], [/migrated_at IS NOT NULL/, { migrated: true }],
    [/reporter_ed_pipelines/, { definition: { steps: "rows" } }]]);
  assert.deepEqual(await activePipelineDefinition(imported, PORTAL), { steps: "rows" });
  assert.equal(imported.queries.some(({ sql }) => sql.includes("reporter_editorial_workspaces")), false);
  const legacy = fakeClient([[/to_regclass/, { ready: false }], [/reporter_editorial_workspaces/, { definition: { steps: "document" } }]]);
  assert.deepEqual(await activePipelineDefinition(legacy, PORTAL), { steps: "document" });
  assert.equal(legacy.queries.some(({ sql }) => sql.includes("reporter_ed_sync WHERE")), false, "a missing table is never named");
  assert.equal(await activePipelineDefinition(fakeClient([[/to_regclass/, { ready: false }]]), PORTAL), null);
});

test("a reset empties one portal's rows, children first, and only that portal", async () => {
  const client = fakeClient([]);
  await resetEditorialRows(client, PORTAL);
  assert.deepEqual(client.queries.slice(0, -1).map(({ sql }) => sql.match(/public\.(\w+)/)[1]), EDITORIAL_ROW_TABLES);
  assert.ok(client.queries.every(({ values }) => values[0] === PORTAL));
  assert.match(client.queries.at(-1).sql, /floor_seq=seq/);
  await assert.rejects(resetEditorialRows(client, "' OR true --"), /portal UUID/);
});
