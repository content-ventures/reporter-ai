# Multi-workspace execution record

Implementation follows [the phased plan](MULTI_WORKSPACE_PLAN.md). A phase is accepted only after its exit checks pass. Production activation is a separate final gate.

## Baseline and pilot identity

The baseline is v1.0.0, commit `f3c41d3544e5835921692c4c1b658a821f7c417b`. Both public production health endpoints reported this commit, `ready: true`, and worker fingerprint `2c74367a1a4bd637` on 2026-10-26. The fingerprint identifies the configured worker origin; it does not independently prove the worker's deployed source commit.

Seafood's existing operation uses portal `10000000-0000-0000-0000-000000000101`, tenant `10000000-0000-0000-0000-000000000001`, slug `reporter-ai`, and the generic display name **Reporter IA**. Adoption retains these IDs and the existing slug. A later explicit workspace rename can change the display name without replacing the operation.

The read-only production inventory found 6 memberships, 22 editorial productions, 30 editorial sources, 108 editorial parts, 33 runs, 12 pipeline records, 315 library/activity items, 30 storage objects, 30 transcripts, 12 news sources, 293 news items and 6 Drive intake records. Counts describe the capture instant, not a frozen production database. Legacy article/carousel tables are empty; current editorial content is in the `reporter_ed_*` rows and must not be mistaken for missing content.

Private evidence lives under the ignored `.reporter-local/multi-workspace/baseline/` directory. `production/manifest.json` contains portal metadata, counts and server-calculated fingerprints for 29 portal-scoped tables. No raw client content, personal directory or credentials were copied. Automatic approval review rejected an initial broad content backup; the completed inventory uses only metadata and hashes. Before a production migration, confirm the provider's recovery window and record its restore point. Local rehearsal never substitutes for that release check.

## M0 validation ledger

| Check | Result |
| --- | --- |
| Design, architecture, content and version policies; lint; type checking | Passed |
| Domain, adapter and script tests | 1,703 passed, 0 failed |
| Production Next.js build | Passed |
| Backend HTTP and worker contracts | 313 passed, 0 failed |
| PostgreSQL integration and concurrent sessions | Passed, including cloud migration replay and document recovery |
| Cloud rehearsal against disposable PostgreSQL | 69 passed, 6 explicitly skipped, 0 failed |
| Connected browser smoke | 85 passed, 1 intentional mobile skip, 1 intermittent visual assertion; both viewport repetitions passed |
| Fixture browser smoke and downloaded exports | 73 passed, 1 preview timeout; isolated repetition passed, including model application and undo |
| Linux ARM64 worker bundle | Passed: 157 files, 10,291,911 compressed bytes; signed FFmpeg 9.0.2 |

The first backend attempt could not open loopback HTTP servers inside the sandbox. Re-running with local network permission passed all 313 tests. The native dependency trace also needed network permission to install Linux ARM64 packages. These are environment limitations, not application defects.

Known baseline instabilities are retained as evidence: the upload progress animation briefly reported internal overflow at 1440 px, and a carousel template preview timed out in the parallel fixture batch. Their unchanged isolated repetitions passed (upload at 1440 and 390 px; template preview, apply and undo). M8 must recheck them; this ledger does not describe the initial batches as completely green. The six rehearsal skips cover simulated account switching, separately tested avatar storage, manual article quote prerequisites, HTTP shape validation, direct suggestion creation and direct run creation. They are not counted as accepted coverage.

The active Seafood pipeline is revision 5, hash `5d4bc21dd5fedbd8`, with editorial map v1 and guide v1; its definition fingerprint is `4609c1e77583cf63dccfbb2323ccfb80`. The existing original-file prefix is `incoming`. The provider metadata reported a 21,600-second (6-hour) recovery window, protected `main` and a separate ready, unprotected `staging` branch. Recheck this time-sensitive metadata immediately before production migration; no production restore or branch mutation was attempted.

The local database is exclusive to this checkout: Docker project `reporter-ai-local-multiworkspace`, port `55442`. Its synthetic schema/data snapshot is retained privately alongside the unchanged connected production build. The integration suite demonstrated recovery from rows to the baseline document and re-import. Production was queried in a repeatable-read, read-only transaction. No production writes or provider generation calls were performed for this baseline.

## Preserved permission contract

Editors and workspace administrators create, edit, submit and export. Approvers and creative reviewers retain their existing assigned review and exact-version decisions. Pipeline configuration and audit access require workspace administration. Existing self-decision and sender rules remain authoritative; adding a platform role must not silently bypass them. Local operator self-review is an explicitly loopback-only development capability. The current simulated "act as" and local role profiles are not production account-switching mechanisms.

## M1 workspace and membership persistence

Migrations 030 and 031 adopt the existing portals rather than creating another Seafood record. Workspace metadata, readiness, revision and lifecycle are additive. New clients start as drafts with empty content and missing configuration clearly identified. An archive request stops new access and stays `archiving` while owned jobs remain; completion preserves history. Resuming actual jobs in other workspaces belongs to M3.

Accounts now project every membership separately. A linked account has one identity and password, independent roles and status per client, and no aggregate union of workspace roles. The legacy single-workspace fields exist only for an unambiguous account. Old person-only role and suspension commands refuse an account with several memberships. Explicit workspace commands use optimistic revisions and preserve self-lockout protection. Account suspension is a separate platform operation.

Invitations are scoped to an account and workspace. Existing accounts authenticate with their existing password, and the new membership remains unavailable until acceptance. Renewing or revoking one link does not invalidate another client's invitation. Repeated authenticated acceptance returns the same result without another acceptance audit entry. Composite foreign keys reject a foreign role or an assignment without the matching membership.

The old migration 020 index definition now permits one open link per account/workspace. This narrow replay compatibility correction prevents a later deployment from failing on two legitimate pending invitations. Cloud and local flow migrations now apply the registered SQL bodies in one transaction, so other requests cannot observe temporary definitions from an earlier migration. A failed batch rolls back instead of committing part of the chain.

M1 validation: 1,707 domain/adapter/script tests and the production build passed; 313 backend tests passed; 75 cloud rehearsal tests passed with the same 6 documented skips. The complete PostgreSQL suite passed on both the upgraded local database and fresh official-image bootstrap, including replay, concurrent sessions and recovery. Fourteen focused HTTP/database cases prove pilot preservation, lifecycle conflicts, independent roles, existing-password acceptance, scoped suspension, global account blocking, invitation renewal and replay with multiple open links. No production migration or write has been performed.

The frozen M0 app was also started against the upgraded synthetic database: its pilot bootstrap returned HTTP 200; a new workspace address returned HTTP 404 rather than another client's data; the new workspace remained present afterwards. Relocating the archived Next build required repairing its dependency symlinks; compiled application JavaScript was unchanged. The retained receipt is `m1-rollback.json` in the private evidence directory.

Implementation is split into reviewable local commits. The next phase replaces the remaining deployment-default request context with an explicit authorized workspace address. The new administration endpoints are persistence capabilities; complete UI onboarding and workspace navigation remain M5 and M6.

## M2 explicit authorization, transport and private assets

Migration 032 and `/api/reporter/w/<slug>/...` now resolve the actual account and the addressed workspace server side. The existing unscoped routes keep their original pilot destination. Invalid, unauthorized and disabled explicit contexts fail closed. `REPORTER_WORKSPACES_MODE` defaults to `off`; `admin` permits only a verified platform operator; `all` permits active authorized memberships. The directory is bounded and paginated.

The platform operator's addressed context uses the real account and explicit administrative capabilities without creating a membership or borrowing another person's identity. Database permissions independently validate this context. Seven focused HTTP/PostgreSQL/S3 cases pass for roles, administrative identity, retry receipts, foreign production refusals, invalid/disabled contexts, immediate revocation, signed image completion, identical image IDs with different bytes, account-photo visibility and an account change during a queued write.

Each connected runtime captures its workspace URL and authoritative account. Pending writes cannot be reattributed after login changes; disposed transports discard late results. IndexedDB opens only after identity resolution and uses a separate database per workspace/account. The original loopback operator retains its legacy database, filtered by actual workspace ownership. This does not copy unknown legacy browser records into another account.

Canonical page addresses `/w/<slug>/...` preserve the existing pages through Next rewrites and bootstrap the explicitly addressed runtime. Global administration/authentication endpoints cannot be smuggled through a workspace prefix. M6 completes the selector, navigation links, leave/upload safeguards and visible account-change reset; these are not claimed as complete here.

Image gateway requests carry an explicit namespace and reject mismatched keys. The new account-avatar route verifies the stored photo, the real viewer and their relationship to its owner. A global account photo can follow its owner between clients; a teammate gains no access to the other client's editorial files. Existing avatar addresses project through a compatibility resolver without rewriting stored client data. The updated worker accepts both legacy pilot gateway calls and explicit namespaces; release must deploy that compatible worker before the app. M3 connects original-file callbacks and worker-generated file keys to their recorded jobs.

M2 validation: `pnpm gate` passed 1,714 tests and the production build; 313 backend tests passed; the full PostgreSQL suite passed on upgrade and fresh bootstrap; 82 cloud rehearsal tests passed with the same 6 documented skips. The ARM64 bundle passed (157 files, 10,292,057 compressed bytes). Browser checks passed: 86 connected scenarios plus one intentional mobile skip, all 74 fixture scenarios including downloaded exports, and a new real PostgreSQL-backed two-tab scenario. The latter saved independent drafts, verified request destinations, reloaded the saved article and confirmed distinct IndexedDB databases in one browser session. No production writes, paid provider requests or rollout activation occurred.

## Acceptance budgets established before implementation

- Integrity: zero loss, ownership changes, duplicate pilot workspaces, unexpected policy resets or changes to historical render definitions. Compare stable rows and configuration fingerprints; explicitly exclude newly recorded activity and worker heartbeats from immutable-data comparisons.
- Isolation: zero cross-workspace reads, writes, receipts, asset access, role carryover or job reassignment. Any such failure blocks advancement regardless of performance.
- Local concurrency: repeat the existing 20-editor HTTP/database workload across two clients, with their own approvers. Require zero application failures, p95 reads below 250 ms and p95 writes below 500 ms on this machine. Also report changes against the recorded single-client 60.2/98.6 ms reference; that older report is context, not a same-build baseline or production SLA.
- Fairness: while both clients have eligible work, a continuously busy client must not prevent another client's next claim beyond two configured dispatch rounds. Provider rate-limit deferrals are measured separately from scheduler starvation.
- Transfer: each workspace bootstrap returns only its own authorized state. A context change must not fetch the complete global editorial data set. Measure bootstrap and polling bytes; investigate growth above 20% against equivalent baseline content before acceptance.
- Provider spend: automated phase checks use synthetic providers and local media. No additional paid generation allowance is inferred from this implementation request. Live editorial comparison requires an explicitly authorized bounded run or existing accepted artifacts.
- Production pilot: require the exact approved app and worker revisions, preserved Seafood counts/configuration, successful authorized two-workspace journey, no isolation or authorization failures, and observation through one complete processing/review/export cycle plus ten consecutive healthy queue probes. Stop activation on a blocking regression; the observation does not certify a full event-day capacity ceiling.

## Activation and recovery contract

Introduce server-owned rollout modes `off`, `admin` and `all`. Default remains `off` until app, worker and additive migrations agree. `admin` exposes the new navigation only to platform administrators; `all` exposes authorized memberships. Explicit new-client requests must fail closed when disabled; they must never fall back to Seafood. Legacy unscoped links resolve only the preserved pilot ID.

Before a rollout, stop new commands for the affected workspace, settle or pause its recorded jobs and preserve the migration/queue receipts. Recover with an app/worker version compatible with retained data, or keep the affected operation paused for a forward fix. Never drop new workspaces or restore a pre-migration database over new writes as a routine rollback. The database suite already rehearses baseline row-to-document recovery; M1 must additionally prove replay, stable pilot fingerprints and old application compatibility after creating a second workspace.

## Phase status

| Phase | Status |
| --- | --- |
| M0 | Accepted with the two recorded intermittent browser checks; baseline frozen |
| M1 | Accepted locally: lifecycle, membership persistence and compatibility checks |
| M2 | Accepted locally: request authorization, context-bound transport and private image access |
| M3 | Next: workspace-owned worker processing and integrations |
| M4–M9 | Not accepted |
