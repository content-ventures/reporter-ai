/** The single ordered source of SQL for every environment. */

// Fresh local database: the official image runs these in name order on first start.
// compose.reporter.yaml mounts the same list; migrations.test.mjs keeps them identical.
export const LOCAL_INIT = Object.freeze([
  ['database/reporter-foundation.sql', '00-reporter-foundation.sql'],
  ['database/reporter-r1.sql', '10-reporter-r1.sql'],
  ['database/reporter-r1-commands.sql', '20-reporter-r1-commands.sql'],
  ['database/local/30-local-seed.sql', '30-local-seed.sql'],
  ['database/local/40-local-roles.sql', '40-local-roles.sql'],
  ['database/migrations/003-local-flow.sql', '50-local-flow.sql'],
  ['database/local/60-local-operator.sql', '60-local-operator.sql'],
  ['database/migrations/004-editorial-workspace.sql', '70-editorial-workspace.sql'],
  ['database/migrations/011-editorial-polling.sql', '80-editorial-polling.sql'],
  ['database/migrations/012-worker-queue-status.sql', '90-worker-queue-status.sql'],
  ['database/migrations/014-editorial-rows.sql', '91-editorial-rows.sql'],
  ['database/migrations/015-editorial-sync.sql', '92-editorial-sync.sql'],
  ['database/migrations/016-editorial-rows-data.sql', '93-editorial-rows-data.sql'],
  ['database/migrations/017-member-profile.sql', '94-member-profile.sql'],
  ['database/migrations/019-background-article-images.sql', '95-background-article-images.sql'],
].map(entry => Object.freeze(entry)));

// Replayed onto an existing local database by `pnpm db:flow`; every file is idempotent.
export const LOCAL_FLOW = Object.freeze([
  'database/migrations/003-local-flow.sql',
  'database/local/60-local-operator.sql',
  'database/migrations/004-editorial-workspace.sql',
  'database/migrations/011-editorial-polling.sql',
  'database/migrations/012-worker-queue-status.sql',
  'database/migrations/014-editorial-rows.sql',
  'database/migrations/015-editorial-sync.sql',
  'database/migrations/016-editorial-rows-data.sql',
  'database/migrations/017-member-profile.sql',
  'database/migrations/019-background-article-images.sql',
]);

// Neon. The first three files create the schema once; everything after them is replayable.
export const CLOUD = Object.freeze([
  'database/reporter-foundation.sql',
  'database/reporter-r1.sql',
  'database/reporter-r1-commands.sql',
  'database/migrations/003-local-flow.sql',
  'database/migrations/004-editorial-workspace.sql',
  'database/migrations/005-neon-cloud.sql',
  'database/migrations/006-cloud-auth-context.sql',
  'database/migrations/007-neon-scheduled-worker.sql',
  'database/migrations/008-neon-object-storage.sql',
  'database/migrations/009-cloud-runtime-recovery.sql',
  'database/migrations/010-remote-link-ingest.sql',
  'database/migrations/011-editorial-polling.sql',
  'database/migrations/012-worker-queue-status.sql',
  'database/migrations/013-worker-on-demand.sql',
  'database/migrations/014-editorial-rows.sql',
  'database/migrations/015-editorial-sync.sql',
  'database/migrations/016-editorial-rows-data.sql',
  'database/migrations/017-member-profile.sql',
  'database/migrations/018-product-name.sql',
  'database/migrations/019-background-article-images.sql',
]);
export const CLOUD_BASE_FILES = 3;

// The cloud tail replayed twice on top of a fresh local bootstrap by `pnpm db:test`.
export const CLOUD_REPLAY = Object.freeze(CLOUD.slice(CLOUD.indexOf('database/migrations/005-neon-cloud.sql')));

// Files whose CREATE TABLE statements define the expected local table catalog.
export const LOCAL_CATALOG = Object.freeze([
  'database/reporter-foundation.sql',
  'database/reporter-r1.sql',
  'database/migrations/004-editorial-workspace.sql',
  'database/migrations/012-worker-queue-status.sql',
  'database/migrations/014-editorial-rows.sql',
]);
