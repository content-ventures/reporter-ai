# Citation and statistics bank delivery

Execution record for Flow 4, based on the [approved phased plan](https://chatgpt.com/space/page_a539aa6b9b388191bf22d84e0f58a1fc).

## Scope and current state

- Baseline: `ac177d7ab42740674a7522a2996cb9408467126b`, version 1.1.1, from `origin/main` on 2026-10-28.
- Branch: `citation-statistics-bank`.
- Runtime: Node 24.14.0 and pnpm 10.33.0, installed from the frozen lockfile.
- Authenticated GitHub author: `fagundesjv`, numeric noreply identity verified through GitHub.
- Phases 0–1 have their technical baseline. Persistence, the connected library, full-text intake, complete-block extraction, review/correction and selection persistence operate locally. Durable checks and dependent-source invalidation are implemented at `1bb0913`; five operational HTTP/worker journeys pass against the isolated local database with synthetic providers. Writing consumption, original-file/archive adapters, calibration and final operational acceptance remain incomplete. The module ceiling remains disabled by default.
- The complete goal includes frontend, backend, UX, QA, historical imports, writing integration and controlled production acceptance.

User clarifications on 2026-10-28:

1. There is currently no historical archive or market-data collection available. Build import capabilities and use explicitly synthetic development data. Real-document inventory, representative-volume measurements and real-archive acceptance remain pending until material is available. Do not invent archive contents or mark that acceptance complete.
2. Any authenticated user with access to the client may record editorial acceptance of bank evidence. Persist the actor, timestamp, reason and exact evidence/check revisions in the audit log. This capability is workspace-scoped and does not grant platform inspection sessions write access. Existing article approval rules keep their own contract.

## Sequential delivery gates

| Phase | Deliverable | Required exit evidence | State |
| --- | --- | --- | --- |
| 0 | Reproducible baseline, inventory and evaluation rubric | Gates, database/replay and smoke baseline; synthetic corpus validated; unavailable real material recorded | Technical preparation complete; real corpus pending |
| 1 | UX journeys, data/API contracts and permission matrix | State map, versioned contracts, valid/invalid examples and domain tests | Contract baseline complete; rendered UX acceptance in phase 5 |
| 2 | Durable persistence and paginated APIs | Empty/existing database migration, legacy reconciliation, contracts, replay and tenant isolation | Implemented: scoped storage/read/write/job APIs and the runtime binding; earlier module SQL/HTTP suites and current local operational journeys pass; final broad revalidation pending |
| 3 | Material ingestion and extraction before article | Complete block coverage, resumable jobs, literal evidence, unknown metadata and retry tests | Plain-text path implemented and technically verified; actual-provider acceptance pending |
| 4 | Internal/external checks and editorial resolution | Context-aware comparison, distinct confidence, immutable decisions and stale-write tests | In progress: queue/comparison/review/stale guards implemented; real-provider and calibration acceptance pending |
| 5 | Complete library UI | Real APIs, URL filters, stable pagination, detail/review flows and accessibility checks | Core flows pass at 1440/390 px and keyboard; new check controls, standalone authors, URL filters and selection recovery remain under development/QA |
| 6 | Writing integration and use provenance | Multi-material article, exact evidence snapshots, server gates and delivered provenance | Pending |
| 7 | Corrections and policy recalibration | Immutable revisions, audit, impact review, policy evaluation and recovery | Evidence corrections/audit and internal-support invalidation exist; material revisions, impact review and calibration remain pending |
| 8 | Archive and market-data adapters | Batch reconciliation, deduplication, original retrieval and actual-document acceptance | Pending |
| 9 | Integrated acceptance and operation | Complete gates, UX/editorial acceptance, staging, pilot, monitoring and recovery | Pending: final broad QA, real providers, staging/pilot and operational acceptance |

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

### Ordered evidence selections

Migration 055 and POST/GET selection APIs capture ordered, immutable evidence/check/policy/applicable-review references across materials. All items must be currently usable; the same locked transaction repeats source, rights, exact revision and visibility conditions. PostgreSQL stamps the creator/creation time and updating actor/time, appends selection history and audit, and creates only actual selected events. Reordering/retries do not duplicate those events; selection never invents an insertion, approval or publication. A selected event points to its first selection revision. An initially null production binding stays null; future production creation links the selection as an input rather than rewriting its earlier attribution.

The selection read boundary checks every referenced material and the current target production. Losing access hides the selection and prevents receipt replay even if the target was originally null. Stale evidence, a new unreviewed correction, missing rights, unreviewed items, conflicting duplicates/checks and foreign/private targets are refused. Concurrent selection edits have one winner. Audit failure rolls back the selection, selected events, history and receipt together. Distinct productions and unattached selections now use separate counting namespaces, preventing equal IDs from collapsing unrelated selections in either library queries or details.

Final validation: all 52 module PostgreSQL/HTTP tests passed against the optimized query, including ordered multi-material snapshots, creation/update audit identity, original selected events, concurrent edits, stale/unreviewed/unauthorized refusal, target/source privacy on reads/replays, atomic rollback, separate counting namespaces and denied direct access to the internal reader. The complete rehearsal passed 181 of 187 tests with six existing skips and no failures; the backend suite passed all 354 tests. `pnpm gate` passed all 1,760 application tests and the production build with the two baseline lint warnings. Isolated `db:flow`/`db:test` passed migration/replay, fresh bootstrap/catalog (48 tables), concurrency and rollback checks. Final logs use `/tmp/reporter-memory-selection-acceptance-{gate,rehearsal,backend,migration,integration}.log`.

The 10,000-record synthetic benchmark initially hit the existing 10-second SQL timeout. Query plans exposed repeated scans and large intermediate payloads. The query now caches bounded metadata subsets, permits indexed reads by record kind, computes search documents once per row, ranks IDs before fetching their page's details, and shares a private row-scoped reader between authenticated query/detail wrappers. Runtime credentials cannot invoke that internal reader. No timeout, authorization, source-fidelity or snapshot condition was relaxed.

The final volume run passed with 5,000 citations and 5,000 statistics, one synthetic material, page size 50, three warmups and 20 measured API requests per scenario. Newest: p50 126.7 ms, p95 372.3 ms, maximum 452.6 ms. Search/relevance: p50 282.2 ms, p95 369.6 ms, maximum 387.3 ms. This meets the provisional local one-second p95 target for this synthetic shape; it does not measure real archive diversity, check/use density, remote network, providers or rendered UI. A mocked authenticated identity feeds actual workspace authorization and API processing. Reproduce with `node --conditions=react-server --import tsx scripts/benchmark-editorial-memory.mjs`; it creates/removes its own disposable PostgreSQL and makes no provider calls. Evidence: `/tmp/reporter-memory-selection-benchmark-bundle.log`; retain the original timeout at `/tmp/reporter-memory-selection-benchmark-diagnostic.log` and diagnostic plans under `/tmp/reporter-memory-selection-search-plan*.log`.

Phase 2 remains in progress: material/job APIs and runtime adapter contracts are required before the frontend binding. The UI and actual article-writing integration remain later deliverables. No remote database, push, PR or deployment was performed.

### Material intake and durable job controls

Migration 056 and authenticated material/job APIs import the complete plain-text original without creating an article. Imports partition every UTF-16 character into ordered blocks of at most 1,000 characters, preserve whitespace and surrogate pairs, and retain unknown dates/authorship. Source/material/job/block creation and the actual actor audit are atomic and idempotent. Blocks are inserted in one database batch. Optional original storage IDs must point to an authorized completed object in the same client.

Material and block pages use signed resource/actor/client/snapshot cursors. Job counts derive from persisted blocks. Cancellation increments the generation and uses revision concurrency; retry keeps completed blocks and their evidence, resets incomplete blocks, checks current source rights and preserves audit. No provider processing or article-use event is implied by enqueueing.

Targeted PostgreSQL/HTTP verification passed all three journeys: exact Unicode original and complete block coverage; idempotency and actual audit actor; stable resource-bound pages, role/origin/file restrictions; cancellation, stale revision refusal and retry preserving completed work. One earlier run lost its disposable database connection; a fresh run passed all three tests. Logs: `/tmp/reporter-memory-materials-rehearsal.log`. The domain partition test also passed. Full release checks and rendered UI acceptance remain pending for the complete functional milestone.

### Complete-block extraction worker

Migration 057 adds generation/lease fencing, immutable job/source/block context, worker-only claim/finish functions, fair dispatch and archive-drain participation. Each turn reads at most three adjacent original blocks, rather than transferring the entire material for each block. The import captures the extraction model. Every original block must finish; counters derive from persisted block results. Cancellation/retry replaces the generation, expired attempts are bounded, and successful evidence plus the block/audit commit atomically. Existing corrected evidence is never overwritten by a retry.

Structured extraction validates literal contiguous anchors, UTF-16 locations, original numeric values/units/qualifiers and stated statistic context. Uncertain or repeated ambiguous fragments fail; unknown attribution, dates and normalization remain unknown. Dense output reports overflow instead of silently certifying a truncated block. Extraction creates no acceptance, check, insertion, approval or publication. Missing rights stop before a provider invocation; a rights change during processing prevents the old result from committing. Editors can explicitly authorize/revoke material use with a reason and actual actor audit before retrying.

The domain tests passed partition/Unicode coverage, cross-boundary ownership, duplicate outputs, exact statistics, unknown authorship, and rejection of paraphrases/inferred context. All six PostgreSQL/HTTP material/worker journeys passed with an injected synthetic provider, including every-block progress, cancellation while a provider is running, three-attempt exhaustion, audited rights confirmation and explicit resumption. No paid model was called. Logs: `/tmp/reporter-memory-worker-rehearsal.log` and `/tmp/reporter-memory-functional-domain.log`. A final dispatcher-path check is recorded separately in `/tmp/reporter-memory-worker-dispatch.log`.

The disposable PostgreSQL readiness check now uses an elapsed deadline and bounded connection attempts, with startup logs on failure. Observed failures occurred during container startup before migrations, not while executing module queries. The application SQL timeout remains unchanged. Full module UI, check pipeline, writing integration, original-file/archive adapters and final acceptance remain in progress; the module ceiling is still disabled by default.

### Connected library interface

The existing `/quotes` destination switches to the new library only when `REPORTER_MEMORY_MODE=on`; the default disabled ceiling preserves the previous page. The connected runtime binds the available `MemoryLibrary` capabilities to authenticated HTTP operations without successful placeholders for unimplemented checks/material revisions. Its transport retains the actual account, workspace, command idempotency identity and opaque signed cursor.

The interface composes only public V3 Design System components. It includes citation/statistic/material views; text, metadata, period, verdict, confidence and usage filters; cursor pages; exact original excerpts; factual confidence separate from editorial strength and actual use; independently paginated history; reasoned manual review; attribution/statistic/metadata correction; explicit legacy/duplicate conflict resolution; ordered selection persistence; full-text material input; processing progress and cancel/retry; and audited rights confirmation/revocation. Unknown authorship and dates stay visible as unknown. The material drawer preserves the original text, and late query results cannot cross accounts or filters.

The bound transport test and scoped lint passed. The implementation remains under QA: final types/build, rendered desktop/phone/keyboard checks, automatic check controls and selection-to-writing integration are not yet accepted. No navigation release, remote database, push, PR or deployment was performed.

### Browser integration corrections

The full gate passed 1,764 tests and the production build at `8697694`; migration replay also passed on the isolated `reporter-ai-local-memory` database (port 55439). Browser QA then found that mutation requests from the new HTTP adapter omitted the existing local-client header. This is now corrected and covered by the transport test. Audit names resolve from known people and authenticated workspace members, and outdated check results no longer appear as current confidence or accept an unsupported decision.

Diagnostic browser runs at 1440 and 390 px confirmed full original-text preservation, material import/cancellation, literal evidence inspection, reasoned review with the actual actor, and selection persistence. They reported one h1, no horizontal page overflow and no console/page errors. These runs explicitly supplied the missing header to isolate other defects; they are not final acceptance. The rendered bank contains only an explicitly labelled synthetic QA corpus, extracted through the real worker with `synthetic-qa` provider results and zero paid calls. Final browser runs must repeat without the diagnostic header after rebuilding the correction. Evidence: `/tmp/reporter-memory-ui-diagnostic.log`, `/tmp/reporter-memory-review-diagnostic.log`, `/tmp/reporter-memory-seed-qa.log`.

### Keyboard lifecycle correction

At `da3bb2a`, the corrected gate passed all 1,764 tests and the production build. Browser import, cancellation, actual-actor manual review and selection passed at 1440 and 390 px without any diagnostic request header, preserving the exact original and reporting no console/page errors or horizontal overflow. The keyboard probe then found that conditionally unmounting a DS overlay skipped its controlled close/presence focus restoration.

The library now keeps its dialogs/drawers mounted through `open=false`, preserves the source drawer beneath a nested material inspection, and resets a successful import's draft/request identity. Closed drawers stop polling and reopen with fresh scoped data. Ordinary refreshes retain the current table so their original row remains available as a focus-return target. Final keyboard and regression smoke results must follow the rebuilt correction. Browser records: `/tmp/reporter-memory-ui-qa.json`, `/tmp/reporter-memory-review-qa.json`; the earlier keyboard failure is retained at `/tmp/reporter-memory-keyboard-qa.log` until its corrected run.

### Literal fact-check pipeline

- Added a framework-free assessment and an injected model/search pipeline for literal claims, independent editorial strength, numbered internal/external supports and contradiction precedence. Unknown source indices and cross-claim citations are discarded; paraphrases, incomplete numeric context and explicit overflow fail before paid searches.
- Same-origin supports, identical republications and the original publisher cannot confirm their own evidence. Factual confidence remains null until a real calibration report exists; a check never silently replaces human acceptance.
- Validation: eight focused domain/pipeline tests pass, including source isolation, missing sources, opinions, provider failures and model drift. Durable check scheduling and UI controls are the next integration step.

### Durable checks and dependency freshness

Migration 058 queues one immutable evidence/policy/previous-check snapshot per check, captures the model and actual requesting actor, deduplicates pending requests and bounds retries. The worker uses leases/generation fencing, retains numbered internal/web excerpts and persists a result only if the target and internal supports still match. Cancellation, correction or a replacement result prevents a late commit. Migration 059 marks checks outdated when an internal support changes revision/origin, is withdrawn or loses rights; historical checks remain auditable. The interface exposes enqueue, status, cancellation, retry, literal claims and retained sources.

Search hits retain an unverified-origin flag. A different publisher URL alone does not prove independent origin: such hits, same-origin material and identical republications provide related context rather than automatic independent confirmation. Plain-text imports without an explicit origin receive the same conservative treatment. Factual confidence remains null and manual acceptance remains revision-bound and audited.

Validation evidence at `1bb0913`:

- Thirteen focused assessment/pipeline/transport/migration-manifest tests pass. Scoped lint passes. Type validation passed before the final origin flag; the final full gate follows this checkpoint.
- Five operational HTTP/worker journeys pass on the guarded local database: idempotent queue/reload/audit, cancellation/replacement, correction before/during processing, bounded failure/retry, internal collection and stale-support rejection. Log: `/tmp/reporter-memory-check-local-final.log`. This local run excludes cloud authentication; the committed disposable suite includes those assertions but has not completed because PostgreSQL initialization exceeded the fixture's startup allowance. No paid provider call occurred.
- The previous exact build `081e793` passed 1,764 tests and production compilation. Its final import/review/selection/keyboard probes passed at desktop and phone widths without diagnostic headers. The broader legacy smoke was stopped after 69 passes, four failures, one interrupted test and one skip; 14 tests did not run. Failures involved the existing material progress animation, news/pipeline loading and source-rating timeout. They remain unresolved; this is not a clean release smoke. Log: `/tmp/reporter-memory-regression-smoke-serial.log`.
- New check controls still require the production-build browser probe. Real-provider quality, writing integration, archive adapters and the final acceptance phase remain pending.

### Writing collection contract

A selected collection now builds one writing source containing only the approved literal excerpts in their saved order. Each segment retains its original bank evidence/check/review/policy snapshot, source anchor and metadata; the complete private originals are not copied. Confirmed citation authors map to existing people, attribution stays outside the literal quotation, and unknown dates/file origins stay unknown. Derived collections are excluded from legacy reconciliation so reusing a quote cannot manufacture independent corroboration.

The pure occurrence observer requires actual saved segment references and matching article words. It records precise article/source ranges, permits literal citation fragments, retains complete numeric context and deduplicates duplicate references. Selection alone, unrelated matching text, edited statistics and foreign source/version references do not create use. This is the domain foundation; production creation, persisted usage and UI consumption are still being connected.
