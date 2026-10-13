# Reporter AI R1 Data Implementation Specification

## Connected local pilot amendment (2026-10-10)

The approved rich-document UI now uses `public.reporter_editorial_workspaces`, added by migration
004, alongside normalized audio intake and the existing outbox. See [LOCAL_BACKEND.md](../docs/LOCAL_BACKEND.md).
New UI documents are not mirrored into the legacy article/carousel tables below. The normalized
three-table model is the earlier target; production normalization and immutable audit projection
still require an explicit migration. Existing SQL contracts and data are preserved. No external
platform, analytical database or login service is required for this local increment.

Deliver the R1 flow from uploaded media to transcription, editable article, human approval, and an editable carousel. Keep three content tables in PostgreSQL on a Reporter-owned foundation for identity, access, storage, audit, and business events. Technical logs use a structured application logger; no analytical database is required for R1.

This is the implementation target, not a statement that R1 is production ready. It supersedes the previous implementation instructions and deferred-capability choices where they conflict. The PostgreSQL schema and narrow commands are reconciled with this target and validated in the isolated local Docker environment; the database is standalone and has no external platform dependency. The schema visualization reflects the contract and local validation, not live database state.

## Standalone scope and delivery prerequisites

Reporter AI owns its database, schemas, credentials, migrations and processing worker. No Media On integration, shared database, external migration ledger or compatibility requirement is part of R1. The local Docker project, volume, network and port are exclusive to Reporter AI.

The foundation in `reporter-foundation.sql` supplies identity, organizations, portals, scoped permissions, storage metadata, audit and queues. The existing English identifiers are retained to avoid destructive renames; `core` and `public` are namespaces of our own database. `core.integration_outbox` is our internal processing queue, not an external integration.

Before production, confirm these delivery inputs:

- Server authentication, portal provisioning, object storage, API and worker readiness.
- The original database Harness and R1 acceptance criteria, including whether carousel delivery requires exported files or only structured slides. The original temporary attachment must be supplied again before claiming full Harness compliance.
- Media upload limits, supported MIME types, provider deadlines, slide limits, and retention policy. The existing twenty-slide limit is a safety ceiling, not a verified Harness requirement.

Do not add speculative tables to resolve these implementation choices. The preserved `public.user_roles` catalog does not grant editorial access or bypass active membership; R1 authorization uses portal roles and explicit permissions.

## Storage responsibilities

PostgreSQL stores current content, review state, access scope, approved revisions, audit records, and durable business events and processing requests. The development flow stores private source files locally in `.reporter-local/`, catalogued with `provider=local`. S3 and rendered output storage are deferred. Technical logs are written as sanitized JSON to application stdout/stderr, not to a new database table.

The Reporter foundation owns `core.users`, `public.portals`, `core.storage_objects`, module flags, portal membership and permissions, `public.audit_log`, `core.integration_outbox` and `public.event_outbox`. Do not create duplicate identity, storage, role or processing catalogs.

Create only these operational tables for the initial flow:

- `public.reporter_transcripts`
- `public.reporter_articles`
- `public.reporter_carousels`

ClickHouse is outside the current R1 scope. Do not create analytical tables, an analytical-delivery queue, or precomputed aggregates in this release. Reconsider a separate analytical store only when measured workload or an agreed integration requirement justifies it.

All physical identifiers use English snake_case. Reporter schemas are `core` and `public`. Product-facing explanations may use Brazilian Portuguese and must not present nullable markers as part of a column name.

## Shared operational rules

Each operational record has an `id` UUID, a required `portal_id` UUID, `created_at` and `updated_at` timestamps with time zone, and a positive integer `revision`. Increment `revision` on every accepted mutation. Commands carry the expected revision and reject stale writes instead of silently overwriting another editor or worker.

Each processing request has a `generation_id` UUID identifying that logical execution. Delivery retries reuse it; a newly authorized generation receives a new value. Persist the current generation on the aggregate and reject results from any older generation. Store `provider_request_id` when supplied by the provider so uncertain responses can be reconciled.

Maintain `provider`, `model`, and operational `error_code` metadata. Articles and carousels also retain `prompt_version`. Successful generated results require their relevant generation metadata. Preserve provider duration and reported usage in the processing audit payload; unknown measurements remain null, not zero.

Portal scope, source ownership, and creator attribution cannot be changed by an ordinary update. Resolve actor identifiers from the authenticated context, not from caller-supplied user IDs. Start transcripts in `queued` and generated articles and carousels in `generating`; runtime inserts cannot bypass processing or review by starting in a terminal state.

Use primary and composite references to enforce same-portal relationships. In particular, `(portal_id, source_object_id)` must reference the corresponding storage object scope. The Reporter schema adds the necessary unique referenced key to its own storage catalog. RLS alone cannot enforce that relationship: PostgreSQL integrity checks bypass row security. [PostgreSQL row security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)

Keep read indexes for portal-scoped chronological lists and the review queue. Add relation lookup indexes when removing the existing one-to-one unique constraints. Do not add indexes to JSON fields until a concrete query requires them.

## Transcription contract

`reporter_transcripts` retains `source_object_id`, `created_by`, `language`, `content`, `status`, `started_at`, and `completed_at`, plus the shared identity, revision, and generation metadata.

Add nullable `segments` JSONB to preserve timed segments when the provider returns them. Each segment has `start_ms`, `end_ms`, and `text`, with nonnegative, ordered times. A provider without timed output leaves this field null; do not fabricate timestamps. This preserves useful input for podcast cuts without creating a segment table.

Validate that the source object belongs to the portal, is completed, has an authorized storage purpose, and passes the configured media limits before enqueueing transcription. Source bytes remain in object storage.

Allowed transitions are `queued → processing → ready` or `queued → processing → failed`, followed by an explicitly authorized `failed → queued` retry. A ready result has nonempty content and valid completion dates. It becomes immutable input for downstream generation; a new transcription is a separate record rather than an overwrite of consumed content.

Remove the global uniqueness constraint on `source_object_id`. Different languages or explicitly requested new transcriptions may use the same source. Duplicate HTTP requests are prevented by command idempotency, not by forbidding legitimate outputs from one file.

## Article and approval contract

`reporter_articles` retains `title`, `content`, `status`, `author_id`, `approver_id`, `review_comment`, `submitted_at`, and `approved_at`, plus shared identity, revision, and generation metadata. Add `approved_revision`, nullable until approval.

Prepare source provenance with these fields:

- `source_kind`: `transcript`, `url`, or `text`.
- `transcript_id`: required for transcript sources and absent for the other source kinds.
- `source_object_id`: required for URL and text sources to reference a preserved input snapshot; absent for transcript sources, whose input is the immutable transcript.
- `source_metadata`: a bounded JSON object for attribution, canonical URL, publication date, and capture date when applicable. It is not a substitute for storing the source snapshot.

Only transcript-based generation is enabled in R1. URL and text entry points remain disabled until their releases. Validate source combinations and same-portal storage references from the beginning; do not create `reporter_sources` or `article_sources` without a demonstrated multisource requirement.

Remove uniqueness on `transcript_id`. One transcript can support multiple independently requested articles. Creating a generation requires a ready transcript and freezes the selected input for that generation.

Allowed transitions are `generating → draft` or `generating → failed`, `failed → generating`, `draft → in_review`, `in_review → approved` or `in_review → changes_requested`, and `changes_requested → draft`.

Draft edits require the current revision. Submission freezes content for review. Approve and request-changes commands verify the expected revision and reviewer permission while locking or conditionally updating the same row. Content cannot be edited while in review. Requested changes are recorded before returning the article to draft.

Approval sets `approved_revision` to the resulting revision and records the authenticated approver and server timestamp. Approved content, source provenance, generation metadata, approval attribution, and revision are immutable in R1. Reopening an approved article is not part of R1; it requires an explicit revision-history design before being introduced.

Enforce initial states and approved-record immutability in PostgreSQL, including inserts and content-only updates. The approval command, snapshot of the approved content, and business event must commit atomically with the audit record. Do not leave this protection to a frontend status control.

## Carousel contract

`reporter_carousels` retains `article_id`, `title`, `slides`, `status`, `created_by`, and `ready_at`, plus shared identity, revision, and generation metadata. Add required `article_revision` and `slides_schema_version`.

Require a reference to the same portal and the article's exact approved revision. This needs a unique referenced key on `(portal_id, id, approved_revision)` in articles and the corresponding carousel reference. Creation also verifies that the article is approved. The worker cannot switch to a different input article or revision.

Remove uniqueness on `article_id`. An article may have multiple independently requested carousel variants. Keep slides in JSONB; no slide table is needed for R1.

Slides schema version 1 is an ordered array of objects with a required nonempty `body` string and an optional nonempty `title` string. Reject nulls, primitives, unexpected fields, oversized text, and arrays outside the configured limits. The array order is the display order. Media references, if required for R1, must use cataloged storage objects and undergo same-portal validation; never accept arbitrary remote asset URLs as trusted output.

Allowed transitions are `generating → draft` or `generating → failed`, `failed → generating`, `draft → ready`, and `ready → draft`. Editing a ready carousel requires returning it to draft in the same transaction, clearing `ready_at`, and incrementing its revision.

If R1 includes rendering or export, include nullable `output_object_id` and `output_revision`. Publish a rendered object only for its exact current carousel revision; return to draft or any content change invalidates the current export. Preserve older files according to retention without displaying them as current. If structured slides satisfy delivery, keep rendering fields and endpoints outside R1.

## Authorization and audit

Register and enable `reporter_ai` using the Reporter-owned tenant and portal module controls. Every Reporter access must explicitly validate that module, current tenant and portal scope, and active membership. Authorization under another enabled module must not grant access to Reporter data.

Register action permissions for reading content, creating or editing content, submitting review, approving or requesting changes, and retrying processing. Map those permissions to Reporter portal roles. Do not invent a parallel ACL or assume that every portal member can approve. Any requirement to forbid self-approval must come from the editorial policy, not an invented role hierarchy.

Use narrow mutation commands and least-privilege grants. Runtime callers cannot set approvers, generation metadata, terminal statuses, or arbitrary actor IDs directly. Workers can persist only authorized processing results; they cannot approve articles or edit unrelated aggregates. Validate command scope, lease ownership, generation identity, and expected revision before accepting a result.

Set authenticated user and job context inside each transaction using the Reporter helpers. Use `reporter_runtime` for API connections and `reporter_worker` for processing; never use the maintenance login in the application. Runtime and worker connections must not own tables or have superuser or RLS-bypass privileges. Test the real deployment roles, not only an administrator connection.

Write review submission, approval, requested changes, explicit retries, and terminal processing outcomes to `public.audit_log` within their business transaction. Include portal, actor or job identity, entity, revision, generation, timestamp, and request correlation. Approval retains the exact approved content snapshot under editorial access and retention rules. Technical logs are not the approval record.

## Processing and durable delivery

Use the Reporter-owned processing queue and narrow worker commands. Reporter request event names are `reporter.transcription.requested`, `reporter.article_generation.requested`, and `reporter.carousel_generation.requested`. Keep business outcomes in `public.event_outbox`. There is no separate analytical transport in R1.

Register dedicated processing job contexts. A processing command and its transport request are written in the same PostgreSQL transaction. A processing result, audit record, and business outcome also commit together. Technical logging remains outside this transaction and must not decide whether an editorial commit succeeds.

Each request envelope carries a stable event ID, tenant and portal, module, entity type and ID, generation ID, expected input revision, request correlation, event schema version, and immutable bounded parameters. Do not include raw content, signed URLs, credentials, or raw prompts in transport payloads.

HTTP creation and retry commands accept a stable idempotency key scoped to the actor, portal, and operation. Repeating the same command returns its original aggregate; reusing the key with different inputs fails. Use the durable processing receipts rather than adding a generic idempotency table. Retain receipts for the published command retry horizon.

Use the implemented claim, lease renewal, attempt accounting, exponential retry, and dead-letter commands. The provider consumer belongs to Reporter AI. Run processing in an appropriate worker or callback flow, with explicit deadlines and provider calls outside long database transactions.

Before accepting a result, revalidate the active generation, lease, expected aggregate state and revision, input provenance, and portal. A lost lease or superseded generation cannot commit output. A crash after provider success but before persistence may repeat the provider call: use its idempotency or result-retrieval API where supported and reconcile `provider_request_id`. Without provider support, do not promise exactly-once execution or billing.

Separate automatic transport retries from a user-requested new generation. Final exhaustion transitions the matching aggregate to a recoverable failed state through an authorized command; dead letters remain inspectable and retryable. Never leave processing records indefinitely stuck because the delivery ledger exhausted attempts.

## Audit events and technical logs

Reuse `public.audit_log` for durable editorial and processing records and `public.event_outbox` for business outcomes. Keep the existing distinction between business events and `core.integration_outbox` processing requests. Do not add an events table or a technical-log table for R1, and do not repurpose the outbox as a permanent analytics archive.

Capture provider duration and reported usage from R1 in a bounded, versioned `after_data.processing` audit object. Include generation and request correlation, provider/model, prompt version when applicable, input revision, terminal status, attempt, `duration_ms`, `usage_unit`, `input_units`, and `output_units`. Define units such as tokens or audio milliseconds and preserve unavailable measurements as null. Relevant bounded metadata may also accompany the business outcome; neither payload includes raw prompts, file URLs, or source content. Approval snapshots remain in the separately authorized editorial audit record.

These measurements preserve useful operational history without creating a billing ledger or an analytical store. Monetary accounting and pricing-version contracts remain outside R1 until authoritative pricing and an actual billing requirement exist.

Use a shared structured logger for API and worker diagnostics. Each JSON record contains `timestamp`, `level`, `environment`, `service`, `component`, `message`, and `schema_version`. Add `request_id`, `job_id`, `generation_id`, `trace_id`, `span_id`, `entity_type`, and `entity_id` when available. `tenant_id` and `portal_id` are optional for platform and pre-authentication failures; a populated portal requires its tenant. Optional `error_code`, `duration_ms`, and allowlisted `attributes` must remain bounded and sanitized.

Redact secrets, raw prompts, editorial content, file URLs, authorization headers, and personal identifiers before serialization. Emit logs to stdout/stderr with explicit payload limits, backpressure, and sanitized error handling. Configure runtime log rotation, retention, and operator-only access for Docker. A browser client cannot query raw platform logs. Logs do not use the editorial transactional outbox and never replace the durable approval audit.

Test redaction, context-free failures, correct correlation, and logging failure behavior. Transient diagnostic logs may be lost during a failure or rotation; business audit and accepted work must remain durable in PostgreSQL. No centralized log-search service or analytical dashboard is part of the current R1 acceptance scope.

## Preparation for later releases

For R2 Hard News and R3 Evergreen, reuse article identity, review, and provenance; enable URL or text intake only when the respective source acquisition and attribution rules are implemented. A future multisource association table is justified only when one article genuinely requires multiple independently managed sources.

For R4 podcast cuts, preserve source media and timed transcript segments now. Introduce cut entities and timing, rendering, and export rules with that release; no cut table is required for R1.

For R5 through R7 multimedia, distribution, and scale, preserve stable entity and generation IDs, versioned event and slide contracts, provider usage, source provenance, and output lineage now. Create publishing, scheduling, billing, or execution-history tables only when their independent lifecycles are implemented.

Do not defer revision safety, exact approval identity, same-portal references, durable processing, or event idempotency. Do defer normalized slides, full editorial version history while approved records remain immutable, generic workflow graphs, prompt catalogs, full-text indexes, caches, and precomputed analytical aggregates unless a concrete R1 requirement establishes their need.

## Implementation sequence

1. Confirm delivery prerequisites and recover the original Harness. Record the Reporter storage, worker, permissions, output-delivery and retention decisions.
2. Bootstrap a fresh Reporter database using the versioned foundation, R1 schema and commands. For the existing local database, apply `migrations/002-standalone.sql` with `pnpm db:migrate`; it preserves data, privileges and credentials. Future schema changes require reviewed forward migrations, not volume resets.
3. Implement database guards and authorized transaction commands for scoped creation, revision-safe edits, review, approval, carousel readiness, and retries. Register module permissions and job contexts.
4. Implement processing consumers, generation fencing, provider reconciliation, dead-letter recovery, and atomic business audit and events.
5. Implement versioned slide validation, timed segment preservation, and any agreed R1 export path.
6. Implement bounded processing audit payloads and a structured logger with redaction, correlation, runtime log rotation, restricted access, and approved retention. Do not provision an analytical database.
7. Update the schema visualization and static tests to reflect this contract. Distinguish locally applied persistence from planned API, storage and worker behavior; validate every displayed field and physical reference against PostgreSQL.
8. Run the integration and operational acceptance checks below, then deploy to a controlled test environment. Enable production portals only after the result is approved.

## Acceptance criteria

R1 persistence is ready only when automated checks against actual PostgreSQL, application commands, and the logging runtime demonstrate all of the following:

- The owned bootstrap applies to a fresh Reporter PostgreSQL database. Existing local data survives the standalone migration, replay is safe, and API/worker readiness checks accept the resulting schema. Later migrations document replay and forward-repair behavior.
- A user from another portal, an unauthorized reviewer, a disabled Reporter module, and a caller authorized only under another module cannot perform the corresponding Reporter operation.
- Cross-portal file references, input references, article references, and output references are rejected. A source still uploading or marked deleted cannot start processing.
- Direct terminal-state inserts and content-only mutations of approved articles fail. Audit snapshots and approval attribution commit atomically with the approved revision.
- Concurrent edits produce a conflict; approval cannot attach to content changed after submission. A carousel can only reference the exact approved article revision.
- Invalid slides fail, including null entries and primitive arrays. Editing a ready carousel clears readiness and invalidates its current export when export is enabled.
- Repeated HTTP commands do not create duplicate aggregates. Intentionally creating a second article or carousel from the same source succeeds. Idempotency-key reuse with different parameters fails.
- Worker crashes before and after provider response, expired leases, automatic retries, new generations, and late responses do not lose accepted work or overwrite current results. Exhausted work is visible and recoverable.
- A result, its audit metadata, and its business event commit atomically. Repeated processing-request delivery cannot commit duplicate or stale outcomes. Business-event consumers retain their documented delivery and idempotency guarantees.
- Logs represent failures without tenant or portal context and contain no prohibited data. Logger failure does not lose accepted editorial work or replace its audit record. Raw logs remain accessible only to authorized operators, and runtime rotation limits disk usage.
- Source, draft, approved article, carousel, pending transport, and audit data can be restored together from the approved backup procedure. Retention and coordinated deletion are tested across PostgreSQL and object storage, subject to audit-retention rules; runtime logs follow their separately approved rotation and retention policy.
- The agreed R1 product flow completes end to end, including exported files if they are part of acceptance. The full repository quality gate also passes; static schema tests alone are not sufficient evidence.

Required operational configuration includes provider timeouts, upload and payload limits, concurrency limits, queue age and failed-work alerts, credential handling, backup and restore targets, and the agreed retention and runtime log-rotation settings. These values must be explicit before enabling production; they must not be guessed from a diagram.

## Current handoff status

The SQL schema, narrow transaction commands, schema visualization and catalog tests are aligned. PostgreSQL 17.9 runs locally in the isolated reporter-ai-local Docker project on 127.0.0.1:55432, using its own volume and network and no ClickHouse. The complete Reporter foundation and three content tables are applied locally, with `reporter_runtime` and `reporter_worker` logins. No external database or API is required. Actual PostgreSQL tests cover scope/permission isolation, revision safety, immutable approval, exact source references, JSON validation, command idempotency, lease fencing, exhausted work and atomic audit failure. Export columns remain reserved and enforced null until export scope is agreed. Safety ceilings and bootstrap details are documented in database/README.md.

Separate PostgreSQL sessions also validate concurrent edits, approval and exclusive worker claims. Migration `003-local-flow.sql` adds local intake/import, state, worker-input, progress and provider-deferral commands without new tables. The Node API and standalone worker implement local uploads, Groq transcription and text generation, editing, manual approval and carousel slides. Local TXT imports have explicit non-AI provenance. A synthetic development operator supplies transaction context; no login or production identity is claimed. Local-only HTTP guards, bounded validation, server-only secrets, sanitized logging and generation checkpoints are implemented. Runtime log rotation currently covers PostgreSQL, not API/worker stdout.

Production authentication, provisioning, S3, rendered carousel exports, extended provider-crash/lease-contention testing, backup/restore, retention and product acceptance remain pending. The original Harness is still needed for a full compliance claim. Local implementation does not establish completed R1 delivery.
