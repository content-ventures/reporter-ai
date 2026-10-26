# Multiuser client workspace implementation plan

Date: October 26, 2026.

Status: implementation plan. Phase completion requires the evidence specified below.

Reporter IA will support independent client workspaces in the same application. Each workspace owns its editorial map, writing guide, team, content and configuration. The platform administrator can navigate every workspace while retaining their authenticated identity. Members can belong to several workspaces with different roles in each.

This delivery precedes the remaining R2 feature work. It advances the workspace capability previously associated with F7.3 without declaring the rest of R7 or the R2 roadmap release complete. The current Seafood Brasil operation is the first client workspace and the operational pilot. Adopt its existing identity, data, team and configuration in place; it must remain usable throughout the transition.

## Product contract

- One client is one workspace. The current Seafood Brasil operation becomes the first workspace using its existing portal ID, records, team, editorial map, writing guide, prompts, templates and integration bindings. Do not create an empty replacement or copy its content into a second Seafood workspace.
- Seafood Brasil is the operational pilot for adopting the workspace model. Naturaltech illustrates a possible future client, not a prerequisite for completing this delivery. Use a separate controlled workspace with authorized synthetic material to prove isolation and dynamic onboarding before adding more real clients.
- Every client's interviews, podcasts, event coverage and other productions stay in that client's workspace. Event details remain production context. There is no workspace per fair, fair switcher or mandatory new event hierarchy in this delivery.
- A single authenticated person can have different memberships and roles across workspaces. Their account identity and password remain the same.
- A workspace owns productions, original material, transcripts, images, citations, news sources, editorial decisions, map, guide, pipeline revisions, assigned templates, integration bindings, usage and activity.
- The platform administrator has an explicit, audited administrative context for any workspace. A workspace administrator manages only their own authorized workspace.
- Normal editorial actions retain their existing authorization, version and approval rules. Viewing another member's experience does not grant that member's identity to the administrator.
- New workspaces, memberships and editorial configuration are managed through the application. Adding a client does not require editing source code, changing a default portal environment variable or deploying another application.
- A new workspace starts with empty client content and its own configuration. Seafood's active settings and content are preserved. An administrator can deliberately copy a configuration preset without copying content, people, approvals or credentials.

## Existing implementation and required changes

The reference application commit is `f3c41d3544e5835921692c4c1b658a821f7c417b`, released as v1.0.0. Phase 0 records the exact approved build that will be used when implementation starts.

| Existing foundation | Required completion |
| --- | --- |
| Database tenants, portals, memberships and portal scoped editorial rows | Keep the existing IDs and relationships; make the client workspace an explicit request and job context. |
| Real accounts, roles, invitations, platform directory and usage | Support several memberships per account, workspace specific role changes and workspace lifecycle management. |
| `resolveReporterContext` and worker transactions select `cloudPortalId()` | Resolve a validated workspace per request and a recorded workspace per claimed job. |
| `PlatformPerson` projects one workspace and one role set | Project the account separately from all its memberships and their statuses and roles. |
| Editable map, guide and immutable pipeline snapshots | Provision independent policies and remove client specific assumptions from shared defaults. |
| Connected rendering uses the shared fixture template catalog | Make template availability and brand settings workspace specific while preserving existing render versions. |
| Drive intake selects a deployment wide owner and secret | Resolve a server owned integration binding for the destination workspace. |
| `SidebarAccount` and `PortalSwitcher` are public DS exports | Compose real workspace navigation and administrative views with these components. |
| Local and simulated account or role switching | Keep these test features separate from production administrative viewing. |

Relevant sources: [platform console](PLATFORM_CONSOLE.md), [writing orchestration](WRITING_ORCHESTRATION.md), [news intake](NEWS_INTAKE.md), [Drive intake](DRIVE_INTAKE.md), [release runbook](RELEASE_RUNBOOK.md), and [development harness](DEVELOPMENT_HARNESS.md).

The inspected Design System pin is `0479b31c567653c76b93ec2ec89eb6976ce31172`. `PortalSwitcher` supports a list, selected value, change handler and a management action; `SidebarAccount` accepts menu sections. The selector's product label will be "Trocar workspace". Any missing visual behavior must be added to the Design System and released under the existing DS workflow.

## Access rules

| Identity or context | Workspace access | Write authority |
| --- | --- | --- |
| Platform administrator | Can list and enter every workspace through the administrative flow. | Explicit platform or workspace administrative capabilities; every write records the real administrator. Existing editorial approval rules still apply. |
| Workspace administrator | Only workspaces with an active administrative membership. | Workspace configuration and team management within the defined permission contract. Cannot grant a platform role. |
| Editor | Only active memberships and content visible under the existing editorial rules. | Existing creation, editing and submission capabilities in that workspace. |
| Approver or creative reviewer | Only active memberships and content visible under the existing editorial rules. | Existing assigned review and exact version approval capabilities. |
| Administrator viewing a member | Selected workspace and content visible to the selected member. | Read only. A write request is refused by the server even if sent outside the UI. |
| Suspended membership or inactive workspace | Defined account or archive recovery view only. | No new editorial actions or jobs through the inactive membership or workspace. |

Suspending one membership does not suspend the person's other memberships. Account suspension is a distinct platform operation. Platform role grants retain their existing controlled process; ordinary workspace management cannot grant them.

## Execution order and ownership

Engineering owns implementation, migration rehearsal, automated verification and technical evidence. João owns the client configuration and editorial decisions, the final operational acceptance, and the exact remote delivery approvals required by the harness. A designated journalist can perform the recorded editorial acceptance.

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| M0 | Seafood baseline, inventory and recovery procedure | None |
| M1 | Workspace and membership contracts and additive persistence | M0 |
| M2 | Authorized context across APIs, database and private assets | M1 |
| M3 | Workspace owned jobs, integrations and resource limits | M2 |
| M4 | Independent editorial policy, prompts and template assignment | M2 |
| M5 | Dynamic workspace and team administration | M1, M2, M3, M4 |
| M6 | Real workspace navigation and browser state separation | M2, M5 |
| M7 | Administrative member viewing and audit | M5, M6 |
| M8 | Full acceptance, isolation, concurrency and regression | M3 through M7 |
| M9 | Controlled production activation and operational handoff | M8 |

Each phase has a coherent review boundary and an exit gate. Implementation may combine compatible local changes, but a dependent phase cannot be accepted on a mocked upstream capability alone. Use cohesive commits and one PR per complete reviewable delivery, following the harness. All checklist items start open.

## M0 Preserve the Seafood baseline

Capture the current working state so later changes can be compared against real behavior and recovered without losing new work.

- [x] Record the application commit, worker-origin fingerprint and bundle validation, migration inventory, active configuration revision and hashes, template inventory, storage layout and enabled integrations. Independently verify the deployed worker source revision at release.
- [x] Map the current Seafood portal, tenant, team, content and configuration to the first workspace. Preserve the existing IDs and historical references.
- [x] Record row counts and integrity fingerprints for existing productions, original sources, versions, approvals, citations and images. Keep private material and credentials outside Git.
- [x] Run the existing complete gate, backend and database checks, worker validation and browser smoke on the exact baseline build. Record intermittent browser failures and their isolated repetitions.
- [x] Document the existing permission and approval behavior, including intentional administrator exceptions, before changing context resolution.
- [x] Define server controlled activation switches for the new context flow and administrator pilot. Document how to stop new pilot work, settle existing jobs and restore compatible behavior.
- [x] Rehearse baseline database recovery in isolation, retain the app build and synthetic configuration snapshot, and specify the application/worker compatibility checks for upcoming migrations. A database restore is not the default rollback after new client writes.
- [x] Set the migration integrity checks, performance and transfer acceptance budgets, provider spend allowance and production pilot observation criteria before implementation results are evaluated.

Exit gate: the baseline, known existing defects, comparison evidence and a demonstrated recovery procedure are recorded. New implementation failures remain distinguishable from baseline failures.

## M1 Define workspaces and membership lifecycle

Reuse the portal as the workspace identity and keep its tenant relationship as an internal authorization boundary. Do not create another client entity duplicating that boundary.

- [x] Extend domain and ports for workspace ID, name, slug, lifecycle, readiness and an account's list of memberships. IDs remain stable if display names change.
- [x] Separate global account data from workspace membership status and roles. Ambiguous legacy mutations refuse instead of choosing a workspace.
- [x] Define workspace creation, rename, activation, archive and restoration. Archiving stops new access and waits for owned jobs before reaching its final state; it never deletes editorial history. M3 connects workspace-aware processing and settlement.
- [x] Make invitations and new signup approval endpoints target an explicit workspace. Existing accounts retain their identity and password. Repeated authenticated invitation acceptance is idempotent.
- [x] Scope role changes and membership suspension to the selected workspace. Preserve controlled platform role grants and self-lockout protection.
- [x] Add composite role/membership ownership constraints and scoped invitation uniqueness. Retain the existing portal-scoped entity and receipt keys; their request-level isolation is extended in M2.
- [x] Implement migrations 030 and 031 with idempotent replay and atomic migration batches, preserving pilot identities, memberships and content/configuration fingerprints.
- [x] Adopt the current Seafood portal in place and initialize missing metadata only, without creating a duplicate pilot or resetting its configuration.
- [x] Rehearse the additive migration and the frozen M0 application against the upgraded synthetic database: pilot bootstrap succeeds, new workspace addresses fail closed in old code, and newly provisioned workspace records remain intact.

Exit gate: one account can be editor in workspace A and approver in workspace B. Suspending A leaves B usable. Old Seafood records retain their ownership and hashes. Provisioning another workspace requires no manual database edits after deployment.

Main implementation areas: `src/domain/workspace.ts`, `src/domain/platform.ts`, session and platform ports, platform SQL and new additive migrations.

## M2 Authorize every request and private asset in its workspace

Use the selected workspace as an explicit addressable context, resolved and authorized by the server. A mutable global "current workspace" cookie must not determine where another browser tab writes.

- [x] Introduce canonical `/w/<workspaceSlug>/...` pages and `/api/reporter/w/<workspaceSlug>/...` endpoints, with runtime-bound HTTP context and server-resolved immutable IDs and permissions.
- [x] Preserve unscoped Seafood links as pilot-only compatibility addresses. Invalid, forbidden and disabled explicit contexts fail closed.
- [x] Require active membership or the explicit real platform administrator context. Scope resource reads, commands and retry receipts to the addressed workspace.
- [x] Apply the shared request guard across bootstrap, editorial commands, sources/transcripts, polling, reviews/exports, citations, images, news, policy, profile and audit routes. M3 verifies original-file callbacks and processing in their recorded workspace.
- [x] Preserve portal-scoped database rows, deltas, revisions and receipts; bind browser transports and image caches to workspace/account; verify signed image preparation/completion and actual downloaded bytes, including identical image IDs in two clients. M6 completes UI cache teardown and navigation safeguards.
- [x] Extend the authenticated image gateway for explicit namespaces while retaining legacy pilot calls. M3 supplies captured job context to worker-generated keys and original-file callbacks.
- [x] Re-read authorization on each request and refuse a queued command after its bound account changes. M6 completes visible logout/account-change cleanup; revoked membership in A already leaves B usable.

Exit gate: direct API requests, private asset requests and old or guessed links cannot read or modify another workspace. Two tabs on different workspaces retain independent destinations for reads and writes. Existing Seafood addresses resolve correctly.

Main implementation areas: `src/server/database.ts`, `request-context.ts`, route handlers, HTTP clients, storage and asset handlers, authorization functions and editorial SQL.

## M3 Run jobs and integrations for their originating workspace

The ownership of work must remain stable after enqueue, independently of which workspace a person currently has open.

- [x] Record tenant, workspace, real initiating actor, input versions, configuration snapshot and retry identity on every queued task. Claims and continuations carry that context through every transaction and callback.
- [x] Update transcription, generation, revisions, image generation, background illustration, fact checking, translation, feed reading and complementary web search. A missing job context stops processing rather than selecting a default client.
- [x] Keep lease fencing, cancellation and idempotent recovery scoped to the job's workspace. Retrying after a restart must not reassign a job, double accept its result or lose already recorded provider usage.
- [x] Add bounded scheduling across active workspaces so one busy client cannot consume every available claim. Carry provider rate limits, per workspace usage ceilings and visible queued or refused states through the scheduling contract.
- [x] Move Drive intake ownership and authorization to workspace specific integration bindings. The credential determines the destination server side; a posted workspace ID alone cannot redirect material. Deduplication includes workspace and remote file identity.
- [x] Bind existing RSS, RSS.app and web search configurations to their workspace. Keep provider secrets server owned; the operator configures or rotates supported client bindings through the authorized integration flow.
- [x] Define behavior for inactive workspaces and suspended initiators. Stop new commands immediately; existing workspace owned jobs retain their recorded actor, use only the workspace's active processing policy, and cannot bypass human approval.
- [x] Record usage, failures and readiness by workspace and initiating actor. Surface failures in the workspace that owns the job. Redact credentials and source content from operational logs.

Exit gate: run at least one complete job for each of two workspaces concurrently, switch contexts, restart a worker and retry a failed task. Each result, private file, usage record and integration intake stays with its originating workspace.

Main implementation areas: worker transactions, claim functions, drain and continuation code, editorial workers, media and image gateways, Drive bindings, news collection and platform usage.

## M4 Make editorial behavior and templates client specific

The main client differences are the editorial map and writing guide. Their effective values must reach every applicable writing and review path.

- [x] Provision independent map, guide, pipeline configuration, research exclusions and version history for each workspace. Keep the current Seafood configuration unchanged unless an explicit separately reviewed change requires otherwise.
- [x] Define generation readiness separately from access: a team can configure its new workspace, but generation explains which required settings are missing instead of silently adopting Seafood's settings.
- [x] Replace Seafood and sector specific assumptions in shared format prompts, fact check instructions, sample defaults and product labels with neutral base rules plus explicit workspace configuration. Rehearse all existing Seafood formats against its preserved preset.
- [x] Keep factual integrity and literal quotation rules as platform invariants. Client communication preferences cannot authorize invented sources or weaken evidence checks.
- [x] Capture workspace ID, policy versions, pipeline and template versions in generated artifacts and execution records. Editing a guide affects future jobs; existing queued jobs and approved versions retain their captured configuration.
- [x] Scope template availability, default template and brand assets to the workspace. Expose assignment and configuration through authorized application APIs, including logo, validated visual preset and licensed typefaces where supported by the renderer; M5 supplies the management screens. A full visual template builder is a separate product feature.
- [x] Preserve old carousel render definitions and export compatibility. Configuration copying is an explicit audited action with a preview of the fields copied, and excludes content, members, approvals and secrets.

Exit gate: two clients using the same authorized synthetic source generate drafts with their respective configured communication rules and exports with the correct assigned identity. Reviewers verify the difference; no client receives the other's terminology, brand or references. Previously approved Seafood exports remain reproducible.

Main implementation areas: editorial policy and pipeline contracts, `format-prompts.ts`, fact check instructions, pipeline snapshots, template/render catalog and configuration screens.

## M5 Manage clients and teams dynamically

Extend the existing platform console so the operator can onboard and maintain a client without a deployment.

- [ ] Add workspace listing, search, creation, editing, readiness, archive and restoration through authorized server operations and public DS components.
- [ ] Guide setup through client identity, map, guide, available templates and the first team membership. Show a precise readiness result before enabling generation.
- [ ] Show every membership for a person. Invite new people or link an existing account to another workspace, define roles per membership and manage pending signups in their selected workspace.
- [ ] Allow workspace administrators to manage the team under the agreed capability matrix. Keep workspace and global account suspension as separately named operations with different effects.
- [ ] Keep approved invitation delivery behavior: the operator can copy and distribute a link; the system does not silently start sending email.
- [ ] Filter platform usage and activity by workspace and person. Retain the distinction between estimated provider cost and actual billing, and represent missing usage honestly.
- [ ] Paginate or bound global directories and searches rather than assuming a permanent limit of tens of people. Validate permission changes during stale forms and concurrent updates.

Exit gate: starting from the platform console, create a second client, configure its policy and identity, invite its editor and approver, accept the invitations and verify generation readiness. The entire setup uses application flows; M8 accepts the full editorial journey after navigation is connected.

Main implementation areas: `src/features/platform`, platform domain and ports, `src/server/platform.ts`, invitation functions, membership management and usage projections.

## M6 Navigate workspaces with the Design System

Expose the completed context contract through the existing application frame.

- [ ] Use public `PortalSwitcher` in the sidebar, labeled "Trocar workspace", with the active client and a management entry for the authorized operator. A member sees their authorized workspaces; the platform administrator sees every workspace.
- [ ] Keep the real signed in identity in `SidebarAccount` and show its current workspace role or administrative context. Provide a clear path back to the platform console.
- [ ] Resolve first login, one membership, several memberships, no memberships, an archived workspace and a deleted or unauthorized deep link. Remember the last valid destination as a navigation preference, not as authorization.
- [ ] Before switching, finish or explicitly resolve unsaved edits and pending uploads. Keep an in progress upload tied to its original destination or cancel it visibly; never redirect it to the newly selected workspace.
- [ ] Replace workspace runtime state atomically. Scope browser caches, draft persistence, IndexedDB, subscriptions, command search, polling cursors, failed write retries and pending responses by account and workspace.
- [ ] Discard late responses from a previous context and prevent new context commands until its bootstrap and permissions are ready. Background jobs continue in their original workspace.
- [ ] Verify desktop, 390 px touch, keyboard, focus return, loading, empty and failure states. Retain the existing breadcrumb and leave guard contracts.

Exit gate: a person with different roles can switch, reload and open two tabs without stale data, role carryover or cross workspace saves. A failed switch preserves their draft or gives an explicit recovery action.

Main implementation areas: session port, state providers, connected runtime, HTTP adapters, sidebar shell, account menu, leave guard and command palette.

## M7 Inspect users as the real platform administrator

Give the administrator access to a person's activity and a controlled view of their experience, while preserving the identity that actually performs an action.

- [ ] From the user directory, open the person's memberships, productions, usage and activity within a chosen workspace. Label person filters so they cannot be mistaken for an account change.
- [ ] Add "Visualizar como usuário" for an active member of the selected workspace. The server establishes a short lived, workspace bound viewing context and checks both the real operator and the selected membership on every request.
- [ ] Intersect visible content with the selected member's actual permissions. Do not combine the member's roles with platform administrator privileges inside this viewing mode.
- [ ] Make the preview read only at the server. Editing, generation, approval, configuration, invitation and role mutations are refused. To perform an authorized administrative edit, the operator exits the preview and acts under their own identity.
- [ ] Display the viewed person and workspace with a persistent DS status and "Sair da visualização" action. Expiry, revocation, logout or workspace change ends the preview. Local simulation profile controls remain separate.
- [ ] Audit preview start and end, expiry and real administrative changes with actor, workspace, target membership where applicable, action, time and correlation. Record before and after values for configuration and permission changes.

Exit gate: João can enter every workspace, inspect a person's operation, view their allowed experience and return to the console. Requests outside the UI cannot mutate data in preview mode, and no change or approval is attributed to the viewed person.

Main implementation areas: platform access, explicit support context, request authorization, directory drawers, account/status composition and audit schema/contracts.

## M8 Prove the complete behavior and Seafood regression

Use isolated environments and authorized synthetic material for automated acceptance. Live provider calls and private client material follow the existing execution and release authorization rules.

- [ ] Run domain and port contracts, PostgreSQL isolation and migration tests, HTTP authorization tests and worker recovery tests for every changed boundary.
- [ ] Run `pnpm gate`, `pnpm test:backend`, the database integration suite, ARM64 worker validation and cloud rehearsal appropriate to the change.
- [ ] Run `pnpm smoke` and `pnpm smoke:fixtures` against the exact production build, preserving all existing scenarios. Add focused connected cases for workspace creation, memberships, switching, policy separation and administrator preview.
- [ ] Exercise the full source to article to review to carousel to approval to downloaded export flow in two workspaces, checking actual downloaded contents and private asset ownership.
- [ ] Include one client with two different coverage contexts, without creating another workspace or requiring a fair navigation control.
- [ ] Exercise a shared account with editor permission in A and approver permission in B, a single workspace account, a workspace administrator, a platform administrator and an account with no authorized membership.
- [ ] Test two browser tabs, late network responses, unsaved edits, an upload in progress, concurrent policy updates, membership revocation, archive/restore, provider failure, worker restart, retry and cancellation.
- [ ] Extend the previous 20 editor local load profile across at least two workspaces, with distinct approvers and bounded jobs from both. Record duration, queue fairness, p95 read/write times and transfer/cost observations against M0; set acceptance budgets before evaluating results. A local rehearsal does not establish a production SLA.
- [ ] Have João or the designated reviewer confirm the second client's map/guide behavior, brand output and the unchanged Seafood workflow. Record any blocking defect with a reproduction and owner.

Exit gate: all final acceptance scenarios below pass on the same reviewed build, required checks pass, no blocking regression remains, and the recovery procedure works with data created by the new flow.

## M9 Activate production and finish the handoff

- [ ] Prepare the cohesive delivery, migration and compatibility notes, configuration changes, exact acceptance evidence and rollback instructions under the repository harness.
- [ ] Obtain the exact push, PR, merge and controlled release approvals required by the harness after the reviewable result exists. Preserve authenticated GitHub authorship and the GitHub to Francal deployment path.
- [ ] Run controlled staging acceptance with the updated app and worker together. Recheck old URLs, old queued jobs, private assets and both workspace contexts before production activation.
- [ ] Release with the new navigation initially limited to the platform administrator in the existing Seafood workspace. Verify the exact deployed commit and version, preserved Seafood identity and configuration, worker readiness, migrations and integration bindings.
- [ ] On production, verify the current Seafood team and editorial flow as the operational pilot. Run a fully authorized second workspace validation with synthetic material, including invitations, generation, approval and export; this does not require onboarding another real client. Verify the administrative path and observe queues and usage for the agreed pilot window.
- [ ] Enable the validated navigation for the participating Seafood members, then make the completed onboarding flow available for future clients. Document client onboarding, membership administration, archive/restore, policy changes, integration setup, support viewing and incident recovery.
- [ ] Update the board and product documentation with the verified state and evidence. Close this delivery only after real operational acceptance; mocks or a selector screenshot alone do not complete it.

Exit gate: the validated behavior is deployed, participating users can operate it, the operator can onboard another client through the UI, and recovery and support instructions have been handed over.

## Final acceptance scenarios

These are completion criteria, not claims about the current application.

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Create a new client from the platform console | Independent workspace, team and configuration, without code, SQL edits, environment changes or another deployment. |
| A02 | Add an existing account to a second workspace | Same identity and password; independent membership status and roles. |
| A03 | Enter as an editor in A and approver in B | Each context exposes only its permitted actions; direct requests enforce the same rules. |
| A04 | Switch workspace with an unsaved draft or upload | Work is saved, retained or explicitly canceled in its original workspace; no silent destination change. |
| A05 | Use A and B simultaneously in two tabs | Independent runtime state, cursors, caches, drafts and write destinations. |
| A06 | Reuse an ID, request key or late response across contexts | No foreign read, replay, accepted mutation or stale result insertion. |
| A07 | Open original files, images and exported packages | Authorized workspace ownership is enforced; original Seafood assets remain readable. |
| A08 | Generate in A while navigating to B | Job, settings, result, files and usage stay in A. |
| A09 | Restart, retry and cancel work for both clients | Fencing and idempotency preserve ownership and reported usage; both clients receive bounded processing opportunities. |
| A10 | Save different maps and guides, then update one | Each client receives its own policy; historical and already queued runs retain their configuration snapshots. |
| A11 | Export an article and carousel for each client | Correct approved version, assigned identity, source references and image credits. |
| A12 | Cover two events for one client | Both remain in the same workspace with production specific event context. |
| A13 | Suspend a membership, then archive or restore a workspace | Rights change at the intended scope; another active membership and preserved history remain valid. |
| A14 | Use Drive or another already supported intake for both clients | Server bound destination, independent configuration and deduplication; no material enters another workspace. |
| A15 | Navigate and inspect users as platform administrator | Every workspace is reachable; actual actor is retained; member viewing is visibly read only and expires or exits correctly. |
| A16 | Attempt global administration as workspace administrator | Global workspace management, platform role changes and unauthorized contexts are refused. |
| A17 | Adopt Seafood as the first workspace and complete its existing editorial workflow | The original portal ID, team, communication settings, material, writing, exact approvals, carousels, private images and actual downloaded exports remain correct, without a duplicate Seafood workspace. |
| A18 | Rehearse activation and recovery with newly created data | Compatible app/worker behavior, no deleted content and no routing of new client work to the legacy default. |

Completion means all phases and these scenarios are accepted. It includes dynamic client onboarding, real multiuser operation and verified production activation. It does not imply completion of unrelated CMS publishing, archive RAG, billing or a new visual template builder; those features must later consume the same workspace contract.

## Delivery boundaries and recovery

Use additive migrations, preserve stable IDs, retain immutable policy/render versions and introduce the new resolver behind server controlled activation. Keep migrations and application/worker compatibility reviewable together. No implementation phase rewrites approved articles or silently replaces Seafood's active communication policy.

Recovery first blocks new affected work, preserves input and output evidence, and settles or pauses the relevant workspace's jobs. Disabling the new navigation must never select Seafood as a substitute destination for another client's request. Restore only a version known to understand the retained schema and queued work; otherwise keep the affected operation paused for a forward fix. Restoring a database backup requires an explicit data reconciliation decision after any new writes.

No calendar or hour commitment is assigned by this plan. M0 and M1 produce the implementation breakdown and estimates from the confirmed contracts and migration inventory; an estimate change does not remove the completion criteria above.
