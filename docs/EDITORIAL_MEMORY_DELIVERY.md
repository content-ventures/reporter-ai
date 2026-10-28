# Citation and statistics bank delivery

Execution record for Flow 4, based on the [approved phased plan](https://chatgpt.com/space/page_a539aa6b9b388191bf22d84e0f58a1fc).

## Scope and current state

- Baseline: `ac177d7ab42740674a7522a2996cb9408467126b`, version 1.1.1, from `origin/main` on 2026-10-28.
- Branch: `citation-statistics-bank`.
- Runtime: Node 24.14.0 and pnpm 10.33.0, installed from the frozen lockfile.
- Authenticated GitHub author: `fagundesjv`, numeric noreply identity verified through GitHub.
- Phase 0 technical preparation and phase 1 contract baseline are complete. The user's clarification permits engineering to proceed with synthetic material; real-corpus acceptance remains an explicit final dependency. Authenticated reads, reviews/corrections, legacy reconciliation and immutable original articles exist behind the disabled server ceiling; the frontend port is not bound and the new product flow is unavailable.
- The complete goal includes frontend, backend, UX, QA, historical imports, writing integration and controlled production acceptance.

User clarifications on 2026-10-28:

1. There is currently no historical archive or market-data collection available. Build import capabilities and use explicitly synthetic development data. Real-document inventory, representative-volume measurements and real-archive acceptance remain pending until material is available. Do not invent archive contents or mark that acceptance complete.
2. Any authenticated user with access to the client may record editorial acceptance of bank evidence. Persist the actor, timestamp, reason and exact evidence/check revisions in the audit log. This capability is workspace-scoped and does not grant platform inspection sessions write access. Existing article approval rules keep their own contract.

## Sequential delivery gates

| Phase | Deliverable | Required exit evidence | State |
| --- | --- | --- | --- |
| 0 | Reproducible baseline, inventory and evaluation rubric | Gates, database/replay and smoke baseline; synthetic corpus validated; unavailable real material recorded | Technical preparation complete; real corpus pending |
| 1 | UX journeys, data/API contracts and permission matrix | State map, versioned contracts, valid/invalid examples and domain tests | Contract baseline complete; rendered UX acceptance in phase 5 |
| 2 | Durable persistence and paginated APIs | Empty/existing database migration, legacy reconciliation, contracts, replay and tenant isolation | In progress: storage, read/review/correction APIs, scoped legacy imports/originals, live article synchronization and duplicate consolidation verified; selection/material/job APIs and runtime contracts pending |
| 3 | Material ingestion and extraction before article | Complete block coverage, resumable jobs, literal evidence, unknown metadata and retry tests | Pending |
| 4 | Internal/external checks and editorial resolution | Context-aware comparison, distinct confidence, immutable decisions and stale-write tests | Pending |
| 5 | Complete library UI | Real APIs, URL filters, stable pagination, detail/review flows and accessibility checks | Pending |
| 6 | Writing integration and use provenance | Multi-material article, exact evidence snapshots, server gates and delivered provenance | Pending |
| 7 | Corrections and policy recalibration | Immutable revisions, audit, impact review, policy evaluation and recovery | Pending |
| 8 | Archive and market-data adapters | Batch reconciliation, deduplication, original retrieval and actual-document acceptance | Pending |
| 9 | Integrated acceptance and operation | Complete gates, UX/editorial acceptance, staging, pilot, monitoring and recovery | Pending |

No phase is accepted merely because a test passed. Record the exact commit, commands, results and remaining limitations at its exit. The missing real corpus is an explicit acceptance dependency; technical fixture coverage cannot substitute for it.

## Existing integration inventory

| Area | Current evidence | Delivery implication |
| --- | --- | --- |
| Sources | `src/domain/source.ts`: immutable versions, hashes, speaker mappings, authorization and multipart metadata | Reuse source identities and original versions; support sources before a production exists |
| Citations | `src/domain/citation-library.ts`: literal excerpt, source/version/hash, production, attribution and curation | Preserve legacy IDs and 1,200-character excerpts; introduce independent extraction without rewriting old records |
| Registry | `src/server/citation-library.ts`: projection of authorized article drafts/versions and curated rows | Replace whole-workspace projection for new queries with indexed server pagination |
| Checks | `src/domain/fact-check.ts`, `src/server/fact-check-pipeline.ts`: fact/declared/opinion/forecast, returned-source guard and editorial overrides | Reuse providers and fidelity checks; add internal evidence comparison and revision-scoped decisions |
| Worker | `src/server/fact-check-worker.ts`: durable post-article checks with leases and fencing | Add pre-article jobs with per-block coverage and immutable execution context |
| Storage | `src/ports/editorial-rows.ts`, `src/server/editorial-store.ts`: typed rows and scoped transactions | Add compatible migrations and workspace-isolated query contracts |
| Library UI | `src/features/hard-news/quotes/`: DS V3 table/cards, curation drawer, check and decision UI | Preserve established composition; add statistics, imports, dates, relevance, confidence and use filters |
| Writing | `src/server/editorial-worker.ts`: current-production evidence and post-writing citation extraction | Select authorized evidence across materials and record actual occurrences by article version |
| Delivery | Existing approval/version/manifest contracts | Preserve exact human-approved article version and include evidence provenance |

## Technical preparation

The worktree owns a separate local database:

```sh
REPORTER_DB_PROJECT=reporter-ai-local-memory REPORTER_DB_PORT=55439 pnpm db:up
REPORTER_DB_PROJECT=reporter-ai-local-memory REPORTER_DB_PORT=55439 pnpm db:flow
REPORTER_DB_PROJECT=reporter-ai-local-memory REPORTER_DB_PORT=55439 pnpm db:test
```

Credentials are unique, generated locally, mode 0600 and ignored by Git. No primary-checkout credentials or client database were copied. App configuration points at loopback port 55439. Rehearsal tests use their own disposable PostgreSQL containers.

Read the installed Next 16.3.8 Route Handlers and Playwright guides before implementation. Read additional installed guides when changing server/client boundaries or data access. UI must use the public DS V3 exports; the 21st design context confirms the existing compact library pattern.

### Baseline validation record

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; 702 locked packages, DS 0.4.0, Next 16.3.8 |
| `pnpm gate` | Passed: policies, lint, typecheck, 1,748 application tests and production build; two pre-existing unused-variable warnings |
| `pnpm test:backend` | Passed: 319 tests, zero failures, no skips |
| `pnpm test:rehearsal` | Passed: 129 tests, zero failures, six declared pre-existing skips, disposable PostgreSQL |
| Isolated `pnpm db:up` | Passed: PostgreSQL healthy on loopback 55439 |
| Isolated `pnpm db:flow` and `pnpm db:test` | Passed: official bootstrap, replay, private intake, concurrent edits/approvals/claims and rollback/reimport |
| Development corpus integrity | Passed: 20 synthetic documents and 23 checks of literal annotations and required categories |
| Production-build smoke | Initial run: 84 passed, one declared skip, four rollout-configuration failures. Corrected server: all ten connected/recovery checks passed at 1440 and 390 px, including all four failures |

Initial sandbox-only backend execution could not bind loopback (`EPERM`). The authorized local-server execution passed all 319 tests. This is an environment restriction, not an application regression. Do not count the failed run as successful verification.

The initial smoke's external server omitted `REPORTER_WORKSPACES_MODE=off`, while `pnpm smoke` sets it for the runner. The four failing checks expected the legacy home/recovery route but received the workspace selector or an active workspace. Restarting the same production build on loopback 3008 with the matching ceiling made all ten connected/recovery checks pass. No application patch was needed. The remaining 84 successful smoke checks are retained as baseline evidence; the full suite was not rerun after the configuration correction.

Baseline evidence logs are local at `/tmp/reporter-flow4-baseline-{gate,backend,rehearsal,db-flow,db-test,smoke,smoke-recheck}.log`. The production build is from the unchanged baseline; the corpus integrity suite was run separately after adding the development data.

## Evaluation data and rubric

`tests/fixtures/editorial-memory.json` is a synthetic development corpus, with expected literal excerpts and contextual numeric observations. Every document is marked synthetic. It is safe for deterministic local tests and mocked-provider contracts. It is not a factual source, a held-out editorial benchmark or proof of real-provider quality.

Required development coverage:

- Named and unknown speakers, attribution mentioned only inside a statement, missing dates, mixed claims and source authorization.
- Brazilian decimal/thousands separators, ranges, approximate and negative values, percentage points, denominators, currency, forecasts and explicit zero.
- Same indicator with different periods/geographies, repeated and genuinely contradictory observations, historical publication versus observation dates.
- Evidence crossing a new block boundary and untouched legacy excerpts up to 1,200 characters.
- Imported text resembling instructions must remain source data and never modify trusted extraction/check policies.

Proposed release targets, to be measured on a real annotated corpus before automatic acceptance:

| Measure | Target | Measurement |
| --- | --- | --- |
| Literal quote fidelity | 100% | Every emitted quote resolves to exact original source offsets |
| Fabricated author/date/number/unit/period/source | Zero critical errors | Compare every field against original evidence and editor annotations |
| Extraction precision | At least 98% | Correct extracted records / all extracted records, assessed separately by kind |
| Relevant evidence recall | At least 95% | Matched required annotations / all required annotations, separately by kind |
| Source/block accounting | 100% | Every input block has a durable terminal result or visible recoverable failure |
| Conflict release | 100% explicit decisions | Every gated use links an applicable actor-stamped decision |
| Retry/migration/tenant boundaries | Zero loss, duplicate occurrences or unauthorized reads/writes | Database reconciliation, concurrency and access tests |
| Query performance | Provisional p95 below 1 s for 10,000 records, page size 50 | Warm local PostgreSQL plus API measurement; repeat on representative real volume |
| Provider time and cost | Not yet calibrated | Record actual model, usage, block size and elapsed time; choose caps before paid pilot |

These are engineering targets, not measured results or active D10 thresholds. D10 remains review-required until a policy is evaluated and explicitly activated. Editorial strength, query relevance and use frequency cannot inflate factual confidence.

Keep a separate held-out real corpus outside the development fixtures. Do not train/calibrate against its expected outputs. Any authenticated workspace member may record an individual editorial acceptance, with immutable evidence/check revisions and identity in audit. Module release acceptance requires the complete measured report and the controlled release workflow.

## Reviewable decisions for subsequent phases

- New blocks are at most 1,000 characters with original positions and recoverable neighboring context. Old sources and citation IDs retain their existing representation.
- Source publication, speech date, statistical period, import and check timestamps are distinct nullable fields.
- A statistic keeps raw value, unit, qualifiers, indicator, period, population, geography, issuing institution, declaring person and primary evidence separately. Normalize only when justified; never infer missing metadata.
- An opinion or forecast is attributed, not automatically searched as a fact. Factual components within a mixed statement remain checkable.
- No search result means unvalidated, not false. Repeated publications with one primary origin are one evidence lineage.
- Use events distinguish selection, draft insertion, exact-version approval and actual publication. Generating/exporting never invents publication; retries cannot inflate use.
- Corrections create revisions and supersession links. Approved article snapshots remain immutable.
- Any workspace member may accept bank evidence, with a reason and revision guard. Platform inspection stays read-only; cross-workspace references are refused.
- Existing navigation remains on its current release contract until the new module passes final acceptance.
- Push, PR, merge, staging and production actions require exact approval under `DEVELOPMENT_HARNESS.md`, after the implementation is reviewable.

## Completion audit

Before declaring the goal complete, verify each phase's authoritative artifacts and runtime behavior, including all 20 QA scenarios in the plan. Missing real material, provider acceptance, editorial UX acceptance, remote approvals or pilot observation remain explicit incomplete requirements. A green local build alone does not close the module.

## Phase 1 execution record

Phase 0 checkpoint: `64fc431`. Phase 1 defines [journeys, wireframes, states, invariants and API contracts](EDITORIAL_MEMORY_CONTRACT.md), the typed domain/application port and the executable review/eligibility rules. The new port has no runtime adapter yet; no successful placeholder implementation or frontend activation was introduced.

Validation: `pnpm gate:quick` passed with 1,756 application tests and the same two baseline lint warnings. The targeted memory/permission suite passed all 12 tests, including exact raw statistic evidence, user identity and revision guards. The separate synthetic corpus integrity suite passed 23 checks. Production compilation and browser regressions remain established at the phase 0 baseline; phase 1 adds no rendered UI.

Phase 1 checkpoint: `e3a0e57`. Real corpus and calibrated provider quality remain outstanding final acceptance dependencies.

## Phase 2 execution record

Implemented strict input schemas for import, original-text capacity, decisions, corrections, source revisions, ordered selections and URL queries. Text validation preserves original whitespace and rejects NUL, malformed Unicode and more than 1 MiB of UTF-8. Unknown actor/workspace fields are refused. Decimal ranges are compared with arbitrary-precision integers rather than floating point; invalid or oversized values return validation failures.

Implemented signed, stateless pagination cursors. They preserve PostgreSQL bigint/microsecond precision and bind the normalized complete query to tenant, workspace, actual actor and a server-provided visibility epoch, with a 30-minute expiry. No GET-side snapshot write is required. The eventual query service must derive the epoch from authoritative permission/source visibility state and validate every page's access again; the codec is not an authorization service.

Validation: the backend regression suite passed 352 tests with zero skips/failures. Ten targeted input/cursor tests passed, including tampering, identity/query changes, expiration, malformed URLs/decimals, precise intervals, duplicates, dates and forged actor fields. Typecheck exposed the project's pre-ES2020 compilation target and an assert overload; the BigInt literal was replaced by its constructor and the assertion by a typed Zod error expectation, then targeted tests and typecheck were repeated.

The following checkpoints implement storage, replay, request receipts, audit, authoritative visibility and authenticated query handlers. Detail/history and write handlers, actual legacy ID/content reconciliation and their PostgreSQL/HTTP contracts remain required to close phase 2. No phase 3 job or new UI activation has started.

### Durable storage and SQL review boundary

Migration 047 adds workspace-scoped heads, immutable historical snapshots, a change/visibility clock and actor-scoped request receipts. Physical storage revisions remain separate from domain revisions, preserving a legacy citation's revision zero and original ID. Composite foreign keys retain sources and parent ownership within the same workspace. Runtime roles cannot read or mutate the tables directly.

Narrow SQL functions read current/exact historical records, scan a stable snapshot, write with an expected physical revision and preserve a request result atomically. A decision is append-only: the database checks current evidence/check/policy/decision revisions, stamps the actual actor and time, and inserts the audit record in the same transaction. All four workspace roles may review. Unknown/withdrawn authorship and withdrawn source rights cannot be released by an acceptance. Imported source text is checked against contiguous original segments; exact UTF-16 offsets remain an application/domain check.

Source and production visibility is checked on every read/write. A source known only through a private production cannot be promoted by another editor. Selection/use target productions have their own access check. Source changes and production access changes invalidate the cursor visibility epoch. This layer is consumed through the existing authenticated request/transaction context; no remote database or client data was changed.

The eight new disposable-PostgreSQL tests passed: migration replay, exact payload/history preservation, repeated IDs in different clients, private sources and productions, all four review roles with database-authored audit, stale decisions/atomic rollback, withdrawn rights, concurrent edits, immutable snapshot reads and actor-scoped idempotent retries. Typecheck and migration-order tests passed. HTTP consumers, complete query filters, legacy backfill and worker/UI integration remain in progress.

Storage checkpoint: `4cf5b94`. The isolated local database also passed `db:flow` and `db:test`, including bootstrap/replay and existing editorial integration checks. The legacy-shaped fixture verifies storage preservation; it does not yet prove reconciliation from the old citation registry.

### Authenticated snapshot queries

Migration 048 and the server query service implement authorized library/policy GETs through the existing authentication boundary. The module requires `REPORTER_MEMORY_MODE=on`; default responses remain 404 and no navigation is activated. Responses are private/no-store. Queries operate over scoped SQL rows and stable historical snapshots, with exact totals, N+1 pagination and signed actor/query/visibility-bound cursors. Timestamp sort keys retain microsecond precision.

Implemented filters include evidence/material kind, free text, all selected topics, person, publisher or issuing institution, company, event, edition, explicit dates/observation overlap, current verdict/confidence and distinct-production use stages. Source fragments stay internal to eligibility evaluation. Private secondary evidence is redacted; a hidden latest rejection never revives an older acceptance. Stale checks provide no current confidence. Default policy activation metadata stays null because no activation happened.

Final validation on this checkpoint: `pnpm gate` passed 1,756 application tests and production compilation, with only the two baseline lint warnings. `pnpm test:rehearsal` passed 147 of 153 tests with six existing skips and no failures. The 18 memory PostgreSQL/HTTP tests cover replay, tenant/source privacy, all review roles, audit/idempotency, filters, usage counts, immutable pagination, microseconds, stale/private checks, hidden decisions, person-name cursor invalidation and local-profile authorization. The backend suite passed 352 tests. Logs: `/tmp/reporter-memory-query-acceptance-gate.log`, `/tmp/reporter-memory-query-acceptance-rehearsal.log` and `/tmp/reporter-memory-query-backend.log`.

Still pending: paginated detail/history, review/correction/selection handlers, actual old-registry reconciliation, extraction/check workers, runtime adapter, UI and writing integration. Synthetic occurrence fixtures test query semantics; real insertion/approval/publication recording belongs to phase 6.

Query checkpoint: `363fbbe`.

### Evidence detail and editorial review

Migration 049 adds snapshot-consistent detail and independently paginated checks, decisions, evidence revisions and occurrences. Each history page declares its exact total/snapshot and next cursor; no full-history claim or silent 25-item truncation is made. Cursors also bind the evidence ID, history kind and limit, so library/history and different histories cannot exchange tokens. Original context includes only the referenced source segments and actual authorization state. Current private checks/reviews remain withheld without reviving superseded acceptance.

The review POST uses the existing bounded JSON reader, same-origin/authentication boundary and actor-scoped command receipts. All four actual roles can accept, reject or request revision. Internal supporting references resolve to accessible immutable snapshots; forged excerpts/origins are refused. Stale checks require a fresh check; an acceptance cannot replace missing attribution or source rights. Concurrent different decisions have one winner; identical retries return the original database-stamped decision and one audit row.

Validation: all 22 targeted PostgreSQL/HTTP memory tests passed. The complete rehearsal passed 151 of 157 tests, with the same six existing skips and no failures. The backend regression passed all 352 tests. `pnpm gate` passed all 1,756 application tests and the production build. Isolated `db:flow` and `db:test` passed bootstrap, replay, concurrency, intake and rollback checks with migrations 048–049. Targeted lint/types and migration policy passed. Evidence logs use `/tmp/reporter-memory-detail-{test,gate,rehearsal,backend,migration,integration}.log`.

The detail port contract now uses explicit `MemoryPage` history collections and a continuation method. This is a deliberate pre-binding refinement for complete, bounded history. Correction/selection/material handlers, legacy reconciliation and later phases remain pending. The module ceiling stays off.

Detail/review checkpoint: `c944508`.

### Audited metadata corrections

Migration 050 and POST `/memory/:id/correction` allow an editor/admin to correct supported metadata and attribution/numeric context with an exact evidence reference and reason. Literal words, original anchor, source, workspace, identity and creation metadata remain immutable. Unsupported or fabricated numeric/unit/qualifier text, unknown people, no-op edits and forged fields are refused. Original-word corrections remain a separate source-version operation, still pending.

Each correction increments the evidence revision and atomically stores a database-authored actor/time/reason stamp, immutable history and before/after audit. The stamp is operational provenance, excluded from the semantic hash; the revision remains part of the guarded reference. Existing acceptance no longer applies after a semantic correction. A subsequent explicit review uses the corrected reference and can release it. Approved article snapshots are not rewritten; impact reporting/integration remains phase 7 work.

Validation: all 25 module PostgreSQL/HTTP tests passed, including concurrent different corrections, idempotent retry, actual audit identity, immutable historical payloads, forbidden roles, invalid numeric context and re-review after a correction. The complete rehearsal passed 154 of 160 tests with six existing skips and no failures. `pnpm gate` passed 1,756 application tests and production compilation; lint/types passed with the same baseline warnings. Isolated `db:flow`/`db:test` passed migration replay and the existing integration suite with migration 050. Logs use `/tmp/reporter-memory-correction-{gate,rehearsal,migration,integration}.log`.

Phase 2 remains in progress. Next required work is actual old-registry reconciliation, selection/material/job APIs and complete runtime contracts. Extraction, external/internal checking, rendered UI, writing provenance and real/provider/editorial/pilot acceptance are not complete. No remote database, push, PR or deployment was performed.

Correction checkpoint: `fcd944b`.

### Curated legacy compatibility

Migration 051 adds bounded reconciliation of actual existing `citation`/`fact_check` rows. POST `/memory/reconcile` processes an authorized ID-ordered batch, reports imported/updated/unchanged/conflicting/unavailable/nonliteral records and exposes `nextAfter` for resumption. A complete repeat pass remains necessary after concurrent additions behind a completed checkpoint; this operation does not claim an immutable archive inventory. Invalid original records remain unchanged and are reported rather than fabricated or silently accepted.

Each imported citation keeps its exact ID, original words (including 1,200-character historical segments), revision zero or later, source hash/version and a complete legacy curation/check snapshot. Relevance, podcast/location data, overrides, historic actors and prior checks remain retrievable in immutable history. The old composite score does not become factual confidence or an activated calibration policy. Unknown dates/authorship remain unknown; source publication, recorded date and import time stay distinct. Binary-original resolution remains phase 8 work: a transcript ID is not invented as a storage-object ID.

When the module ceiling is on, existing editorial commits synchronize changed curated citations, checks and source metadata in the same transaction. A failed compatibility write/audit rolls back the original commit too. Source/prod ownership and tenant isolation repeat at the SQL boundary. Source documents with old pilot workspace aliases remain unchanged; authorized read fragments derive the canonical workspace from their actual database row owner. Historical service work without an initiating actor is left for an explicitly attributed backfill rather than inventing a user; modern actor-bound jobs retain their captured context.

A new-bank correction survives later legacy edits. Semantic divergence persists as a conflict and blocks acceptance/use. POST `/memory/:id/legacy` requires the current bank reference, the exact legacy snapshot hash, a keep-bank/apply-legacy choice and a reason. Resolution records the actual actor and increments the bank revision; a fresh editorial acceptance remains necessary. Merely changing legacy curation/old-check history does not overwrite an explicit bank correction or inflate confidence.

Validation: all 30 memory PostgreSQL/HTTP tests passed, including explicit preservation of an ID already associated with a different material. The final complete rehearsal passed 159 of 165 tests with six existing skips and no failures. The backend suite passed 352 tests; the final `pnpm gate` passed 1,756 application tests and production compilation with the same two baseline lint warnings. Isolated `db:flow`/`db:test` passed bootstrap/replay and existing editorial concurrency/rollback checks with migration 051. Final logs: `/tmp/reporter-memory-legacy-final-gate.log`, `/tmp/reporter-memory-legacy-final-rehearsal.log`; backend/migration/integration logs use `/tmp/reporter-memory-legacy-{backend,migration,integration}.log`.

Remaining legacy scope: citations calculated only from article drafts/versions, faithful occurrence reconstruction and conflict-safe handling of the same source words in productions with different visibility. Those original articles are untouched; no fabricated use occurrence or publication was imported. Worker/provider acceptance, the runtime adapter, ingestion, UI and writing integration remain pending. The new module is still off by default and phase 2 is not closed.

Curated compatibility checkpoint: `027d993`.

### Article-derived legacy citations and originals

Migration 052 preserves exact observed article piece/version documents in an append-only, workspace/production-scoped table. Its narrow functions repeat authorization and verify the current document hash before taking a copy. Runtime roles cannot read/mutate the table directly. Evidence links its actual original document and retains the complete legacy citation/check payload, while current confidence stays separate.

POST `/memory/reconcile/articles` processes bounded quote outcomes, scans at most five documents per command and resumes inside a document using its exact hash and offset. Repeated quotes are accounted for, and unmatched/ambiguous quotations or invalid body/metadata get explicit outcomes identifying their production/part. A changed partial-resume document returns 409. Repeated passes do not duplicate evidence/history, and an older article cannot replace newer provenance. Source-metadata refresh still uses that newer saved original after its live draft was overwritten.

Article-only bank identities are stable per production and referenced source segment; the old computed citation ID and raw payload remain intact and discoverable through an authorized alias lookup. The same words in a public and a restricted production therefore cannot share private editorial metadata. A curated citation belonging to that same production keeps its existing canonical identity only when its source reference matches exactly. Two speakers repeating the same words retain distinct records and attribution. Current and historical original article documents can be fetched by the associated evidence and snapshot hash, independently of an overwritten live draft. New-bank corrections and explicit legacy conflict resolution retain their previous guards.

The mapper now resolves older NFC/whitespace presentation into one exact original UTF-16 span, including combining characters and emoji. It preserves original words/whitespace, does not join disjoint passages, and does not manufacture dates or authors. Known HTTP/HTTPS source URLs remain valid; lineage uses the source's own URL/identity rather than another production's private curation link.

Final validation: all 35 module PostgreSQL/HTTP tests passed, including repeated words from different speakers, matching curation, ambiguous multi-reference refusal, historical originals, resume conflicts, role/tenant isolation and correction preservation. All 12 targeted citation/normalization/provenance domain tests passed. `pnpm gate` passed 1,760 application tests and production compilation with only the two baseline lint warnings. The backend suite passed 353 tests. The final full PostgreSQL rehearsal passed 164 of 170 tests with six existing skips and no failures. Isolated `db:flow`/`db:test` passed bootstrap, replay, catalog (48 tables), concurrency and rollback checks. Final sequential logs use `/tmp/reporter-memory-article-acceptance-{gate,rehearsal,backend,migration,integration}.log`.

An earlier rehearsal overlapped the build and returned an unexplained 500 in the 1,000-production transfer-budget case. Its isolated three-case rerun and two subsequent complete rehearsals passed. The first failure's underlying cause was not identified; retain `/tmp/reporter-memory-article-rehearsal.log` and `/tmp/reporter-memory-article-budget-recheck.log` rather than treating that first run as green.

Still required before phase 2 closes: live synchronization of newly written article projections, supersession/deduplication when curation is added after a projection, selection/material/job APIs and remaining runtime contracts. Faithful historical/current occurrence recording belongs to the writing integration gate; this evidence migration deliberately records no fictional use. UI, providers, real-corpus and controlled-release acceptance remain pending. The module ceiling stays off.

### Transactional article synchronization

Migration 053 adds narrow reads for a changed article and paginated, already imported variants affected by source/check edits. The existing editorial transaction invokes the same literal reconciliation used by article backfill after committing its row changes and before the database COMMIT. Valid new article piece/version observations preserve their exact original and project citations without requiring a manual workspace scan. Attributed workers keep the initiating actor; legacy automation without an actor remains explicitly deferred to attributed backfill. The disabled module ceiling keeps the original editorial write path compatible.

Source/check refresh reads the variant's saved original, so removing its quote from a later draft does not discard the bank record or prevent metadata maintenance. Explicit bank corrections survive incoming changes; unresolved semantic divergence continues to block acceptance/use. Old checks remain raw legacy history and never become current bank confidence. A compatibility/audit failure rolls back the article write, evidence history and original snapshot together. Evidence projection still creates no selected/inserted/approved/published occurrences.

The live path processes only changed article documents and affected saved variants, with at most 100 refresh references per read. Total write latency at representative article/source fanout still requires measurement before activation; this is synchronous reconciliation, not an asynchronous queue. Unmatched/ambiguous or invalid historical observations retain the existing explicit batch-report path; durable ingestion/error jobs and repair UI remain later deliverables.

Final validation: all 40 module PostgreSQL/HTTP tests and TypeScript checks passed. This includes runtime/worker saves, disabled-ceiling compatibility, source/check refresh after quote removal, exact historical originals, tenant/privacy boundaries, audit rollback and correction preservation. `pnpm gate` passed all 1,760 application tests and the production build, with the two baseline lint warnings. The complete PostgreSQL rehearsal passed 169 of 175 tests, with six existing skips and no failures; the backend suite passed all 353 tests. Isolated `db:flow` and `db:test` passed migration/replay, fresh bootstrap/catalog (48 tables), concurrency and rollback checks. Logs use `/tmp/reporter-memory-sync-{targeted,gate,rehearsal,backend,migration,integration}.log`.

Phase 2 remains in progress. Supersession when curation arrives after an article projection, selection/material/job APIs and runtime adapter contracts are still required. Extraction/check workers, UI, writing integration and real/provider/editorial/pilot acceptance remain pending. No remote database, push, PR or deployment was performed.

### Conflict-aware duplicate consolidation

Migration 054 and canonical legacy reconciliation now consolidate an article projection only when its actual production, source version/hash, segment reference and literal anchor match. An unchanged projection is automatically superseded when matching curation arrives. Its old ID, original article, decisions, corrections and occurrences stay readable; the canonical record does not inherit old acceptance or fictional use events. Repeated imports cannot resurrect a superseded projection. The active library excludes retired records by default; explicit status selectors retain historical snapshot pagination and exact totals.

A bank correction or unresolved legacy divergence creates a pending duplicate choice and blocks acceptance/use without discarding the correction. Editors/admins resolve it through a reasoned POST guarded by both current evidence references. They can preserve the variant's metadata/attribution in an audited canonical correction or keep current curation. Canonical legacy conflicts require their existing explicit resolution first. The resulting audit includes the actual actor, timestamp, choice, reason and exact canonical snapshot. Source words, raw legacy rows and approved article snapshots are unchanged. SQL guards refuse acceptance of pending duplicates and prevent other compatibility writers from erasing the choice or reviving a retired record.

Final validation: all 45 module PostgreSQL/HTTP tests passed in the complete rehearsal, including automatic consolidation, preserved originals/old decisions, historical status pagination, explicit choices, SQL anti-bypass guards, actor-scoped retries, concurrent alternatives, atomic rollback and refusal to merge different productions or speakers. The full rehearsal passed 174 of 180 tests with six existing skips and no failures. The backend suite passed all 354 tests; `pnpm gate` passed 1,760 application tests and the production build with the same two baseline lint warnings. Isolated `db:flow`/`db:test` passed migration/replay, bootstrap/catalog (48 tables), concurrency and rollback checks. Final logs use `/tmp/reporter-memory-duplicates-{gate,rehearsal,backend,migration,integration}.log`.

The port has a typed duplicate-resolution method, but its runtime adapter and rendered UI remain pending. Phase 2 is not closed: selection/material/job APIs and runtime contracts remain required, followed by the ingestion, checks, UI, writing, corrections, adapters and complete acceptance gates. No remote database, push, PR or deployment was performed.
