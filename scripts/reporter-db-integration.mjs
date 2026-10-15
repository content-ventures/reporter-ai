import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { context, docker, root, sql } from "./reporter-db.mjs";

const userContext = `SELECT set_config('app.access_mode','user',true),set_config('app.module_key','reporter_ai',true),
  set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true),
  set_config('app.portal_id','00000000-0000-0000-0000-000000000101',true),
  set_config('app.user_id','00000000-0000-0000-0000-000000000011',true);`;
const workerContext = "SELECT set_config('app.access_mode','job',true),set_config('app.job_key','reporter-ai-processing',true);";

function parallelQuery(id, query) {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  return new Promise((accept, reject) => {
    const child = spawn("docker", ["--context", context, "exec", "-i", id, "psql", "-XAt",
      "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-U", "reporter_admin", "-d", "reporter_ai_local"], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("close", (code) => accept({ code, stdout, stderr }));
    child.stdin.end(query);
  });
}

async function verifyConcurrency(id) {
  const run = (query) => docker(["exec", "-i", id, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
    "-U", "reporter_admin", "-d", "reporter_ai_local"], { input: query });
  const output = run(`BEGIN;
SET SESSION AUTHORIZATION reporter_runtime;
${userContext}
SELECT public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,'race.transcript','{}') AS transcript \\gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
${workerContext}
SELECT id AS event FROM public.reporter_claim('race-worker-01') \\gset
SELECT public.reporter_start(:'event','race-worker-01');
SELECT public.reporter_complete(:'event','race-worker-01',1,'{"content":"Race input","provider":"fixture","model":"fixture"}');
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_runtime;
${userContext}
SELECT public.reporter_create('article',:'transcript',3,'race.article','{}') AS article \\gset
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION reporter_worker;
${workerContext}
SELECT id AS event FROM public.reporter_claim('race-worker-01') \\gset
SELECT public.reporter_start(:'event','race-worker-01');
SELECT public.reporter_complete(:'event','race-worker-01',1,
  '{"title":"Race title","content":"Race body","provider":"fixture","model":"fixture","prompt_version":"v1"}');
RESET SESSION AUTHORIZATION;
SELECT 'TARGET='||:'article';
COMMIT;`);
  const target = output.match(/^TARGET=([0-9a-f-]{36})$/m)?.[1];
  if (!target) throw new Error("Concurrency fixture missing");
  const session = `BEGIN; SET SESSION AUTHORIZATION reporter_runtime; ${userContext}`;
  const edits = await Promise.all(["A", "B"].map((name) => parallelQuery(id,
    session + `SELECT public.reporter_edit_article('${target}',2,'Edit ${name}','Body ${name}'); SELECT pg_sleep(0.3); COMMIT;`)));
  if (edits.filter((result) => result.code === 0).length !== 1
    || edits.filter((result) => /40001/.test(result.stderr)).length !== 1)
    throw new Error("Concurrent edits did not produce exactly one winner and one revision conflict");
  run(session + `SELECT public.reporter_submit_article('${target}',3); COMMIT;`);
  const reviews = await Promise.all([1, 2].map(() => parallelQuery(id,
    session + `SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000012',true);
      SELECT public.reporter_review_article('${target}',4,true,NULL); SELECT pg_sleep(0.3); COMMIT;`)));
  if (reviews.filter((result) => result.code === 0).length !== 1
    || reviews.filter((result) => /40001/.test(result.stderr)).length !== 1)
    throw new Error("Concurrent approvals did not produce exactly one winner");
  const valid = run(`SELECT (SELECT revision=5 AND approved_revision=5 AND status='approved'
    FROM public.reporter_articles WHERE id='${target}')
    AND (SELECT count(*)=1 FROM public.audit_log WHERE entity_id='${target}' AND action='reporter.article.approved')
    AND (SELECT count(*)=1 FROM public.event_outbox WHERE entity_id='${target}' AND event_type='reporter.article.approved');`).trim();
  if (valid !== "t") throw new Error("Concurrent approval did not retain one exact audit/business result");
  run(session + "SELECT public.reporter_create('transcript','00000000-0000-0000-0000-000000000301',1,'race.claim','{}'); COMMIT;");
  const claims = await Promise.all(["race-worker-A", "race-worker-B"].map((owner) => parallelQuery(id,
    `BEGIN; SET SESSION AUTHORIZATION reporter_worker; ${workerContext}
      SELECT 'CLAIM='||count(*) FROM public.reporter_claim('${owner}'); SELECT pg_sleep(0.3); COMMIT;`)));
  if (claims.some((result) => result.code !== 0)
    || claims.filter((result) => /^CLAIM=1$/m.test(result.stdout)).length !== 1
    || claims.filter((result) => /^CLAIM=0$/m.test(result.stdout)).length !== 1)
    throw new Error("Concurrent claims did not reserve the job exactly once");
  console.log("PASS real concurrent edits, approvals and worker claims (separate PostgreSQL sessions)");
}


async function verifyCatalog(run, baseline) {
  const actual = JSON.parse(run(`SELECT jsonb_agg(jsonb_build_object(
    'name',n.nspname||'.'||c.relname,
    'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'nullable',NOT a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(conname) FROM pg_constraint WHERE conrelid=c.oid),
    'indexes',(SELECT jsonb_agg(indexname) FROM pg_indexes WHERE schemaname=n.nspname AND tablename=c.relname),
    'references',(SELECT jsonb_agg(jsonb_build_object('constraint',k.conname,'from',f.relnamespace::regnamespace::text||'.'||f.relname,
      'fromColumns',(SELECT jsonb_agg(a.attname ORDER BY v.ordinality) FROM unnest(k.confkey) WITH ORDINALITY v(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=v.attnum),
      'toColumns',(SELECT jsonb_agg(a.attname ORDER BY v.ordinality) FROM unnest(k.conkey) WITH ORDINALITY v(attnum,ordinality)
        JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=v.attnum),
      'deleteRule',CASE k.confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' ELSE 'NO ACTION' END))
      FROM pg_constraint k JOIN pg_class f ON f.oid=k.confrelid WHERE k.conrelid=c.oid AND k.contype='f')))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('core','public') AND c.relkind='r';`));
  const { default: assert } = await import("node:assert/strict");
  const files = ['database/reporter-foundation.sql','database/reporter-r1.sql','database/migrations/004-editorial-workspace.sql'];
  const ddl = (await Promise.all(files.map(file => readFile(resolve(root,file),'utf8')))).join('\n');
  const expected = [...ddl.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+\.[a-z_]+)/gi)].map(match => match[1]);
  assert.deepEqual(actual.map(table => table.name).sort(), [...new Set(expected)].sort(), 'SQL table catalog');
  const normalized = actual.map(table => ({ ...table, constraints: (table.constraints ?? []).sort(), indexes: (table.indexes ?? []).sort(), references: (table.references ?? []).sort((a,b) => a.constraint.localeCompare(b.constraint)) })).sort((a,b) => a.name.localeCompare(b.name));
  if (baseline) assert.deepEqual(normalized, baseline, 'Installed tables, fields, constraints, indexes and relations match a fresh SQL bootstrap');
  console.log('PASS SQL catalog and ' + actual.length + ' installed tables' + (baseline ? ' match a fresh PostgreSQL bootstrap' : ''));
  return normalized;
}

export async function verifyFreshBootstrap(source, baseline) {
  source ??= await readFile(new URL('../database/tests/r1.integration.sql', import.meta.url), 'utf8');
  const name = "reporter-ai-local-bootstrap-check";
  const configuration = await readFile(resolve(root, "compose.reporter.yaml"), "utf8");
  const image = configuration.match(/^    image: (.+)$/m)?.[1];
  if (!image?.startsWith("postgres:17.9@sha256:")) throw new Error("Unexpected verification image");
  const files = ["database/reporter-foundation.sql", "database/reporter-r1.sql",
    "database/reporter-r1-commands.sql", "database/local/30-local-seed.sql", "database/local/40-local-roles.sql",
    "database/migrations/003-local-flow.sql", "database/local/60-local-operator.sql", "database/migrations/004-editorial-workspace.sql"];
  const destinations = ["00-reporter-foundation.sql", "10-reporter-r1.sql", "20-reporter-r1-commands.sql",
    "30-local-seed.sql", "40-local-roles.sql", "50-local-flow.sql", "60-local-operator.sql", "70-editorial-workspace.sql"];
  // No persistent volume, published port, external network or existing database.
  // A name collision fails at docker run; it never stops a pre-existing container.
  const id = docker(["run", "--detach", "--name", name, "--network", "none",
    "--label", "reporter-ai.verification=bootstrap", "--tmpfs", "/var/lib/postgresql/data:rw",
    "-e", "POSTGRES_DB=reporter_ai_local", "-e", "POSTGRES_USER=reporter_admin",
    "-e", "POSTGRES_PASSWORD=temporary-bootstrap-admin-only",
    "-e", "REPORTER_RUNTIME_PASSWORD=temporary-bootstrap-runtime-only",
    "-e", "REPORTER_WORKER_PASSWORD=temporary-bootstrap-worker-only",
    ...files.flatMap((file, index) => ["--mount",
      "type=bind,source=" + resolve(root, file) + ",target=/docker-entrypoint-initdb.d/" + destinations[index] + ",readonly"]),
    image]).trim();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const status = docker(["exec", "-e", "PGPASSWORD=temporary-bootstrap-admin-only", id,
          "psql", "-h", "127.0.0.1", "-XAt", "-U", "reporter_admin", "-d", "reporter_ai_local",
          "-c", "SELECT obj_description(to_regprocedure('public.reporter_local_state()'),'pg_proc')='reporter-local-flow-v1' AND EXISTS(SELECT FROM core.users WHERE id='00000000-0000-0000-0000-000000000031')"]);
        if (status.trim() === "t") { ready = true; break; }
      } catch {
        if (docker(["inspect", id, "--format", "{{.State.Running}}"]).trim() !== "true")
          throw new Error("Fresh bootstrap failed (" + docker(["inspect", id,
            "--format", "exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}"]).trim()
            + "): " + docker(["logs", "--tail", "45", id]));
      }
      await delay(500);
    }
    if (!ready) throw new Error("Fresh bootstrap failed: " + docker(["logs", "--tail", "30", id]));
    const run = (query) => docker(["exec", "-i", id, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
      "-U", "reporter_admin", "-d", "reporter_ai_local"], { input: query });
    const forward = await readFile(resolve(root, "database/migrations/002-standalone.sql"), "utf8");
    run(forward);
    run(forward);
    console.log("PASS standalone forward migration replay (no data deletion)");
    const flow = await readFile(resolve(root, "database/migrations/003-local-flow.sql"), "utf8");
    run(flow); run(flow);
    console.log("PASS local-flow migration replay (no data deletion)");
    run(source);
    run(await readFile(resolve(root, "database/tests/local-flow.integration.sql"), "utf8"));
    const editorial = await readFile(resolve(root, "database/migrations/004-editorial-workspace.sql"), "utf8");
    run(editorial); run(editorial);
    run(await readFile(resolve(root, "database/tests/editorial.integration.sql"), "utf8"));
    await verifyCatalog(run, baseline);
    console.log("PASS fresh official-entrypoint bootstrap and PostgreSQL integration suite");
    await verifyConcurrency(id);
    for (const path of ["database/migrations/005-neon-cloud.sql","database/migrations/006-cloud-auth-context.sql",
      "database/migrations/007-neon-scheduled-worker.sql","database/migrations/008-neon-object-storage.sql",
      "database/migrations/009-cloud-runtime-recovery.sql"]) {
      const migration = await readFile(resolve(root,path),"utf8");
      run(migration);run(migration);
    }
    const cloudUpload = run(await readFile(resolve(root,"database/tests/cloud-upload.integration.sql"),"utf8"));
    if (!cloudUpload.includes('PASS private multipart registration and idempotent transcription enqueue')) {
      throw new Error('Cloud upload integration did not complete');
    }
    console.log('PASS cloud migrations replay and private multipart intake');
    console.log(run(await readFile(resolve(root,'database/tests/cloud-review.integration.sql'),'utf8')).split('\n').filter(line=>line.startsWith('PASS ')).join('\n'));
  } finally {
    // Remove only the exact disposable ID created by this invocation. Its private
    // tmpfs contains synthetic test data; no persistent/user volume is removed.
    docker(["stop", "--time", "5", id]);
    docker(["rm", id]);
  }
}

export async function runIntegration() {
  const baseline = await verifyCatalog((query) => sql("reporter_admin", query));
  const source = await readFile(new URL("../database/tests/r1.integration.sql", import.meta.url), "utf8");
  const result = sql("reporter_admin", source);
  const checks = result.split("\n").filter((line) => line.startsWith("PASS "));
  for (const check of checks) console.log(check);
  if (checks.length !== 11) throw new Error("Not all PostgreSQL integration groups completed");
  const flow = sql("reporter_admin", await readFile(resolve(root, "database/tests/local-flow.integration.sql"), "utf8"));
  const flowChecks = flow.split("\n").filter(line => line.startsWith("PASS "));
  for (const check of flowChecks) console.log(check);
  if (flowChecks.length !== 4) throw new Error("Not all local-flow integration groups completed");
  console.log(sql("reporter_admin", await readFile(resolve(root, "database/tests/editorial.integration.sql"), "utf8")).split("\n").filter(line => line.startsWith("PASS ")).join("\n"));
  await verifyFreshBootstrap(source, baseline);
}
