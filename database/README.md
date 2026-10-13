# Reporter AI R1 PostgreSQL

For the approved UI's connected local flow, see [LOCAL_BACKEND.md](../docs/LOCAL_BACKEND.md).
Run `pnpm db:flow` to apply repeatable audio and editorial migrations to the existing Reporter
volume. Migration 004 stores the server-owned document/version/approval aggregate; the legacy
article and carousel API below remains intact but is not mirrored by that UI.

The local PostgreSQL database implements the three R1 operational tables, revision-safe
editorial commands, scoped permissions, processing leases, and atomic audit/business events.
The [R1 specification](R1_IMPLEMENTATION_SPEC.md) remains the product and persistence contract.
ClickHouse is not required or provisioned.

## Local environment

Run commands from this checkout. Docker Desktop must be running in the local
`desktop-linux` context. The guarded runner refuses remote Docker endpoints, ambiguous
containers, unexpected volumes/networks, and an occupied port. It never stops another service.

- Compose project: `reporter-ai-local`.
- Container: `reporter-ai-local-postgres-1`.
- PostgreSQL: `17.9`, official image pinned by digest in `compose.reporter.yaml`.
- Address: `127.0.0.1:55432`; database: `reporter_ai_local`.
- Persistent volume: `reporter-ai-local_postgres_data`.
- Exclusive bridge network: `reporter-ai-local_reporter`.
- API login: `reporter_runtime`; processing login: `reporter_worker`.
- Migration/maintenance login: `reporter_admin`; never use it for API or workers.

Create `.env.reporter-db` from `.env.reporter-db.example` with three distinct local passwords
of 24–128 letters, digits, underscores, periods or hyphens. The actual file is ignored by Git.
This checkout already has generated local credentials. Do not reuse another application's
credentials, volumes, ports, databases, networks or Compose configuration.
Local mode reads database credentials only from this file. Neon/Vercel credentials may coexist
in `.env.local`, but are never used against the Docker address.

```sh
pnpm db:up
pnpm db:status
pnpm db:test
pnpm db:psql
pnpm db:stop
```

`db:stop` stops only this PostgreSQL service and preserves its volume.
There is deliberately no reset, prune, volume-deletion or global Docker shutdown command.
Logs rotate at 10 MiB per file, retaining three files; they are accessible to local Docker
operators, not through an application endpoint. PostgreSQL statement, parameter and verbose
error-detail logging are disabled to keep editorial values out of diagnostic logs.
API and worker emit bounded, allowlisted JSON diagnostics to stdout. Their production rotation and retention remain pending.

API connection URL: `postgresql://reporter_runtime:<REPORTER_RUNTIME_PASSWORD>@127.0.0.1:55432/reporter_ai_local`.
Workers use `reporter_worker` with `REPORTER_WORKER_PASSWORD`. Keep both on the server.
Frontend code must never receive a database password or connect directly to PostgreSQL.

## Bootstrap and forward migration

Reporter AI owns all schemas, tables, helpers, logins and queues in this database. No external platform baseline or API is required. The official entrypoint runs these files in order on a fresh volume:

1. `reporter-foundation.sql`: identity, organizations, portals, access, storage, audit and queues.
2. `reporter-r1.sql`: three content tables, constraints, indexes, RLS and guards.
3. `reporter-r1-commands.sql`: authorized commands and durable processing delivery.
4. `local/30-local-seed.sql`: synthetic tenants, portals, editor/reviewer and a catalog-only media object.
5. `local/40-local-roles.sql`: distinct local logins and the schema-readiness marker.
6. `migrations/003-local-flow.sql`: local intake/import and narrow API/worker bridges.
7. `local/60-local-operator.sql`: synthetic development operator with local editorial permissions.

The synthetic storage record does not contain real media bytes. Do not use local seed data
or local credentials in production. The English `core` and `public` schemas are our own
namespaces, not shared databases. The preserved `public.user_roles` catalog does not authorize
editorial actions; only active membership and portal permissions do.

Initialization is not replayed on an existing volume. To convert the earlier Reporter local
installation without deleting data or recreating the volume, run:

```sh
pnpm db:migrate
pnpm db:up
pnpm db:test
```

The forward migration `migrations/002-standalone.sql` verifies the Reporter database marker
and isolated cluster, renames the previous logins to `reporter_runtime`/`reporter_worker`,
preserves their SCRAM credentials and grants, replaces the private authorization helpers,
and updates the readiness marker to `reporter-r1-v2`. Replay is safe. No rows, tables,
volumes or other Docker projects are deleted.

The bootstrap schema files are apply-once and reject accidental overwrite. Future changes
must use reviewed forward migrations; do not reset a volume to apply SQL changes. Readiness
checks require the command signatures and final marker, not merely an open socket.
The visualization describes the versioned catalog and local validation, not live database state.

## Operational model

`public.reporter_transcripts`, `public.reporter_articles` and
`public.reporter_carousels` are the three content tables. Same-portal composite references,
generation identity, timed transcript segments, exact approved article revisions and
versioned slides are enforced in PostgreSQL. Source bytes remain on private local disk in development.

Runtime and worker roles cannot mutate these tables directly or execute internal helpers.
The isolated `reporter_executor` NOLOGIN role owns only narrow functions and is never granted
to either login. Runtime SELECT requires active `reporter_ai` scope and `reporter.read`.
Existing portal roles must explicitly grant `reporter.edit`, `reporter.submit`,
`reporter.review` and `reporter.retry` as appropriate. Production roles are not auto-enabled.

Runtime commands:

- `reporter_create(kind, source_id, input_revision, idempotency_key, parameters)`.
  Kinds: `transcript`, `article`, `carousel`. A storage input uses revision 1;
  articles require the ready transcript's current revision; carousels require the exact approved revision.
  Only transcription accepts parameters, currently an optional `language`.
- `reporter_edit_article(id, expected_revision, title, content)`.
- `reporter_submit_article(id, expected_revision)`.
- `reporter_review_article(id, expected_revision, approve, comment)`.
- `reporter_edit_carousel(id, expected_revision, title, slides)`.
- `reporter_ready_carousel(id, expected_revision)`.
- `reporter_retry(kind, id, expected_revision, idempotency_key)`.

Creation returns an aggregate UUID; retry returns its new generation UUID. Other editorial
commands return the resulting revision. SQLSTATE `40001` represents a stale revision,
generation, lease or incompatible state; `42501` represents permission denial;
`23514` represents invalid domain data; `22023` represents invalid command parameters.

Before production, derive identity from server authentication. The development API uses the fixed operator ending in `031`, never a browser-supplied actor. Set context transaction-locally using the
Reporter server transaction adapter, not browser input, and never leak it between pooled requests:

```sql
BEGIN;
SET LOCAL app.access_mode = 'user';
SET LOCAL app.module_key = 'reporter_ai';
SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
SET LOCAL app.portal_id = '00000000-0000-0000-0000-000000000101';
SET LOCAL app.user_id = '00000000-0000-0000-0000-000000000011';
-- Set app.request_id and app.correlation_id to server-generated UUIDs when available.
SELECT public.reporter_create('transcript',
  '00000000-0000-0000-0000-000000000301', 1, 'local-request-001', '{}');
COMMIT;
```

Prepared URL/text provenance is not an enabled intake. Reserved nullable export fields
remain blocked by `ck_reporter_carousels_export_disabled`; accepting/rendering files requires
a separate reviewed migration and product agreement. No rendered-file export endpoint is implemented. The UI downloads transcript TXT, article Markdown and structured slide JSON.

## Processing contract

A dedicated worker uses `app.access_mode=job` and
`app.job_key=reporter-ai-processing` inside each transaction with the `reporter_worker` login.
Call `reporter_claim(owner)`, then `reporter_start(event_id, owner)` immediately before
starting the provider operation. Claim reserves one event for 60 seconds without consuming
an attempt; start verifies the generation/revision and increments the attempt. Renew every
20 seconds with `reporter_renew`. Source availability/provenance is revalidated at start and
completion. If start returns a processed event with `INPUT_UNAVAILABLE`, do not call the
provider: the aggregate, audit and failed outcome have already committed atomically.
Provider calls run outside database transactions.

`reporter_complete(event_id, owner, attempt, result)` rechecks the lease, attempt, generation
and aggregate revision and commits the result, audit and business event atomically.
`reporter_release(event_id, owner, attempt, sanitized_error_code)` schedules exponential
transport retry from five seconds to one hour. Eight exhausted attempts become inspectable
dead letters, and the next claim sweep atomically moves their aggregates to failed.
An authorized user retry creates a new generation; old responses cannot overwrite it.

Keep processing requests in our internal `core.integration_outbox` and business outcomes in
`public.event_outbox`. The processing consumer belongs to Reporter AI; it does not depend on
another product's cache drainer or worker. Run `pnpm dev` for the local API/UI and `pnpm worker` separately for processing. Audio and text are transmitted to Groq using the server-only key.

Creation/retry receipts are retained in transport payloads with a scoped unique index.
Retain those rows for the agreed HTTP retry horizon, including completed rows. Reusing a key
with different inputs fails; intentional variants use new keys. Successful chunk/generation checkpoints are reused across retries. Delivery may still repeat provider
calls after a crash between provider success and checkpoint persistence.
There is no promise of exactly-once provider execution or billing.

The worker result allowlist accepts generated `title`, `content`, `segments` or `slides`
as appropriate, plus provider/model/request/prompt-version/error-code metadata and optional
`duration_ms`, `usage_unit`, `input_units`, `output_units`. Units are `tokens` or `audio_ms`.
Unknown measurements are null. Durable usage is stored in `audit_log.after_data.processing`;
transport and outcome payloads do not contain raw content, file URLs or prompts.
Only the editorial approval audit contains the approved content snapshot.

## Explicit local safety ceilings

These are proposed development ceilings, not recovered Harness requirements. Confirm them
before production. Version them through migrations if the agreed contract changes:

- Completed, unexpired, privately owned `reporter-source` catalog entries: 1 byte to 2 GiB in the local-flow migration;
  allowed MIME types are listed in `core.reporter_source`. FFprobe validates the container and audio track; duration is limited to three hours. TXT imports must be UTF-8 and at most 1 MiB. Ten-minute overlapping audio parts are converted to mono 16 kHz FLAC below the provider upload limit.
- 1–20 slides for draft/ready, at most 1 MiB of slide JSON, body up to 20,000 characters
  and optional title up to 500. Unknown fields, nulls and primitives are rejected.
- At most 20,000 ordered nonoverlapping transcript segments and 2 MiB of segment JSON.
- Article content up to 2 MiB, title up to 500 characters, review comment up to 4,000.
- Source metadata up to 16 KiB, request parameters up to 4 KiB,
  worker result envelope up to 4 MiB; provider metadata up to 256 characters.

## Verification and remaining R1 work

`pnpm db:test` checks actual PostgreSQL under runtime/worker session authorization.
Transactional fixtures roll back all content and permission changes. A second, disposable
Reporter-only container validates the official entrypoint from a fresh tmpfs, with no
published port, persistent volume or external network, and is removed after validation.
Static catalog tests additionally compare SQL fields, constraints and indexes to the diagram.

The suite covers module/portal/membership isolation, source scope/status, initial states,
timed segments, idempotency and valid variants, review permission, stale revisions, immutable
approval and its snapshot, exact approved carousel input, invalid slides, ready invalidation,
lease expiry, attempts/dead-letter recovery, explicit retry and atomic audit failure.
Separate concurrent connections also verify one winning edit, one winning approval and one
exclusive worker claim. Concurrent fixtures exist only in the disposable container.

Local intake/import validation, worker input, progress, Retry-After deferral, operator review and state isolation are also tested against PostgreSQL.

Production readiness still requires real authentication and provisioning, API/worker rotation and alerting,
provider-crash/reconciliation and longer lease-contention tests, backup/restore,
retention/deletion policy and full product acceptance. The original Harness must be supplied
again before claiming complete compliance. Local SQL validation is not completed R1 delivery.

## Neon cloud bootstrap

The cloud path is separate from the Docker-only seed and credentials. With ignored Neon owner URLs present,
run `pnpm db:cloud:migrate`, then `pnpm db:cloud:roles`. The second command creates fresh least-privilege
runtime/worker passwords and writes their URLs only to ignored local env files. Never use `DATABASE_URL` from
the application process.

Cloud signup does not grant editorial access. Provision a known person explicitly after they choose their
login e-mail: `pnpm db:cloud:grant -- --email person@example.com --name "Person" --role admin`. The verified
Neon Auth subject is bound to that pre-provisioned record on first sign-in. Migration 005 creates the Reporter
workspace, role catalog, auth-session resolver and database-backed worker heartbeat; it does not seed a person.

Large cloud uploads remain disabled until private Neon Object Storage and direct multipart upload are deployed.
The transitional cloud worker can be run from a controlled machine with its own private cache, but is not the
final hosted media-processing architecture.
