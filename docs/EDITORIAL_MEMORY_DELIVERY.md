# Citation and statistics bank delivery

Execution record for Flow 4, based on the [approved phased plan](https://chatgpt.com/space/page_a539aa6b9b388191bf22d84e0f58a1fc).

## Scope and current state

- Baseline: `ac177d7ab42740674a7522a2996cb9408467126b`, version 1.1.1, from `origin/main` on 2026-10-28.
- Branch: `citation-statistics-bank`.
- Runtime: Node 24.14.0 and pnpm 10.33.0, installed from the frozen lockfile.
- Authenticated GitHub author: `fagundesjv`, numeric noreply identity verified through GitHub.
- Phase 0 technical preparation and phase 1 contract baseline are complete. The user's clarification permits engineering to proceed with synthetic material; real-corpus acceptance remains an explicit final dependency. The module remains unbound to runtime and unavailable as a new product flow.
- The complete goal includes frontend, backend, UX, QA, historical imports, writing integration and controlled production acceptance.

User clarifications on 2026-10-28:

1. There is currently no historical archive or market-data collection available. Build import capabilities and use explicitly synthetic development data. Real-document inventory, representative-volume measurements and real-archive acceptance remain pending until material is available. Do not invent archive contents or mark that acceptance complete.
2. Any authenticated user with access to the client may record editorial acceptance of bank evidence. Persist the actor, timestamp, reason and exact evidence/check revisions in the audit log. This capability is workspace-scoped and does not grant platform inspection sessions write access. Existing article approval rules keep their own contract.

## Sequential delivery gates

| Phase | Deliverable | Required exit evidence | State |
| --- | --- | --- | --- |
| 0 | Reproducible baseline, inventory and evaluation rubric | Gates, database/replay and smoke baseline; synthetic corpus validated; unavailable real material recorded | Technical preparation complete; real corpus pending |
| 1 | UX journeys, data/API contracts and permission matrix | State map, versioned contracts, valid/invalid examples and domain tests | Contract baseline complete; rendered UX acceptance in phase 5 |
| 2 | Durable persistence and paginated APIs | Empty/existing database migration, legacy reconciliation, contracts, replay and tenant isolation | Pending |
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

Next: phase 2 persistence, additive migrations, authenticated server operations, tenant/source visibility, request receipts, immutable review audit, legacy reconciliation and indexed snapshot pagination. Register the phase 1 commit from this document's Git history when recording phase 2. Real corpus and calibrated provider quality remain outstanding final acceptance dependencies.
