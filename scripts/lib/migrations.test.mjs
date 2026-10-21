import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { CLOUD, CLOUD_BASE_FILES, CLOUD_REPLAY, LOCAL_CATALOG, LOCAL_FLOW, LOCAL_INIT } from "./migrations.mjs";

const root = new URL("../../", import.meta.url);

test("compose mounts exactly the shared local bootstrap list, in order", async () => {
  const compose = await readFile(new URL("compose.reporter.yaml", root), "utf8");
  const mounts = [...compose.matchAll(/^ {6}- \.\/(database\/[^:]+\.sql):\/docker-entrypoint-initdb\.d\/([^:]+):ro$/gm)]
    .map(([, file, destination]) => [file, destination]);
  assert.deepEqual(mounts, LOCAL_INIT.map(([file, destination]) => [file, destination]));
  const names = LOCAL_INIT.map(([, destination]) => destination);
  assert.deepEqual(names, [...names].sort(), "the image runs init files in name order");
  assert.deepEqual(names, [...names].sort(new Intl.Collator("en-US").compare), "bootstrap dependencies also keep their order under the image locale");
});

test("every listed migration exists", async () => {
  const files = new Set([...LOCAL_INIT.map(([file]) => file), ...LOCAL_FLOW, ...CLOUD, ...LOCAL_CATALOG]);
  for (const file of files) await access(new URL(file, root));
});

test("local replays and the cloud tail keep shared migrations in the same order", () => {
  const sharedInCloud = CLOUD.filter(file => LOCAL_FLOW.includes(file) && !file.includes("/local/"));
  const localMigrations = LOCAL_FLOW.filter(file => !file.includes("/local/"));
  assert.deepEqual(sharedInCloud, localMigrations);
  assert.deepEqual(CLOUD.slice(0, CLOUD_BASE_FILES),
    ["database/reporter-foundation.sql", "database/reporter-r1.sql", "database/reporter-r1-commands.sql"]);
  assert.equal(CLOUD_REPLAY[0], "database/migrations/005-neon-cloud.sql");
  assert.ok(CLOUD.indexOf("database/migrations/012-worker-queue-status.sql")
    < CLOUD.indexOf("database/migrations/013-worker-on-demand.sql"), "cloud overrides follow shared helpers");
});
