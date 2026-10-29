# Editorial memory contract

## Durable import batches

The batch manifest is independent of articles and contains at most 100 per-document entries. Each entry retains the proposed title/type/metadata/rights/origin, original filename, byte size, SHA-256 and explicit delimiter. Unsupported, empty and oversized files remain visible as refused entries. File contents still obey the original reader's 1 MiB bound.

Batch reports distinguish missing files, interrupted uploads, stored originals ready for intake, recoverable failures, refusals, included materials, existing materials and occurrences requiring review. The owner and administrators may resume a batch; peers cannot inspect another user's unfinished manifests. Every mutation retains the actual actor, time and before/after audit. Revision checks refuse stale file or metadata replacement; editing accepted entries uses the material's existing correction flow.

Original registration and the batch-item binding commit together before external storage. Storage holds no database transaction. Completion clears the pending item atomically. An administrator and the batch owner can resume the same bound original without allocating a second file. Material/source/job creation and the item's reconciliation result commit in one transaction; an audit failure rolls them all back.

Batch intake compares exact file hashes only among currently visible materials. An unchanged visible document/context is reused. A different edition, origin, rights, parser dialect or revised original requires an explicit current-candidate choice and reason. Reuse preserves the new occurrence's proposed metadata and filename; a deliberately distinct document records its relation to the reviewed candidate. Candidate IDs disappear when their source becomes private. Canonical materials, earlier source versions and approvals are never silently rewritten.

Batch listing uses signed actor/workspace/visibility-bound cursors and a stable creation-order ceiling. Live item progress may change without moving batches between pages. Browser reloads can recover server manifests and stored originals; files that never reached storage must be selected again. General single-file reimport integration, the batch UI and complete rendered acceptance remain required until recorded in the delivery log.

Phase 1 contract for Flow 4. Domain: `src/domain/editorial-memory.ts`. Application port: `src/ports/editorial-memory.ts`. Changes to these contracts require a recorded reason, updated consumers and rerun contract tests.

## User journeys and wireframes

Use the existing workspace shell, breadcrumbs and public DS V3 library composition. No new visual primitives, CSS, icons or substitute component libraries. The current quote bank remains available until the replacement is accepted behind the module activation gate.

### Library

```text
TopBar: Workspace > Citações e estatísticas
PageHeader: Citações e estatísticas                    [Importar material]
Tabs: Citações | Estatísticas | Materiais | Pendências
FilterBar: SearchField | filters | sorting
DataTable: identity / original excerpt or value / source / period / check / confidence / uses
Pagination
BulkBar: ordered selection > [Usar na pauta]
Drawer: original evidence > source and dates > checks > review > history and actual uses
```

Reuse `PageStack`, `PageHeader`, `FilterBar`, `Tabs`, `DataTable`, `Pagination`, `BulkBar` and `Drawer`. Columns become accessible stacked details at 390 px; the page never adds horizontal scrolling. Quote author and statistic indicator are the primary opening actions. Keep the library search/filter state when closing details or returning from a production.

### Import and processing

```text
ResponsiveDialog: Importar material
FieldGroup: title / kind / input (text or supported file) / authorization
Optional source metadata: publication / speech date / institution / company / event / edition / URL
[Importar]
Materials list: document > processing state > completed / total blocks > visible errors
Material detail: original source and revision | extracted records | pending metadata
Failed item: [Tentar novamente]; running item: [Cancelar]; closing the dialog keeps the job
```

Reuse the existing material ingestion and upload ports; unsupported/oversized/invalid files get an actionable refusal before queueing. Progress percentages require a known completed/total count. Missing dates stay unknown. An unknown speaker can be reviewed, never automatically mapped from an introduction in prose.

### Evidence and editorial review

```text
Drawer heading: author or statistic indicator
Source evidence with original context and location
DescriptionList: source / publication / speech or observation period / institution / scope
Checks: internal evidence | external sources | contradictions or missing evidence
Confidence and its factors; editorial strength and query relevance appear separately
Review: Aceitar | Recusar | Solicitar revisão
Required reason, current evidence/check/policy revisions, then [Salvar decisão]
Timeline: actor / timestamp / decision / exact revision / reason
```

Use `Prose`, `DescriptionList`, `Badge`, `Field`, `Textarea`, `RadioGroup`, `Button` and `Timeline`, with source links and existing check-panel patterns. Any authenticated workspace member can submit a review. Permission changes, source withdrawal and a stale revision are rechecked by the server. A stale decision keeps its typed reason and offers explicit reload; it never silently overwrites another review. Audit records are append-only and include the actual session actor.

### Writing and corrections

Selection preserves explicit order and immutable evidence/check/policy snapshots. `Usar na pauta` opens the existing production flow with authorized materials. A blocked item names its next action, such as confirming authorship or reviewing a contradiction. The studio exposes evidence and occurrence history through DS overlays. A correction requires a reason and creates a new revision; source-word corrections create a source version. Show affected work in progress while preserving approved article snapshots.

## Required interaction states

| State | Behavior |
| --- | --- |
| Loading | Existing DS skeleton/busy region; no fabricated counts or provider progress |
| Empty library | `EmptyState` plus authorized import action |
| Empty filtered result | Keep filters; offer clear/reset; distinguish it from a failed request |
| Partial extraction | Show available results and failed/pending blocks; do not imply full coverage |
| Provider unavailable/quota/cancelled | Specific state, original input retained, bounded retry where applicable |
| Unauthorized or inspection | `AccessState` or read-only controls; API and SQL enforce the same rule |
| Stale evidence/check/decision | Show conflict, retain unsaved reason, reload the exact current revision |
| Withdrawn source | Show withdrawn state; refuse selection/use and accepting unavailable evidence |
| Unknown author/date/period | Explicit unknown label; never replace with import date or a mentioned person |
| Keyboard/reader/zoom/mobile | Labelled fields, logical tab order, focus restoration, announced asynchronous status, 390 px and 200% zoom |

## Data invariants

- Material identifies an existing immutable `SourceVersionRef`. Original files and source rights follow existing private-storage and source contracts.
- Anchors retain exact UTF-16 segment offsets. Cross-segment excerpts include consecutive context with newline separators. Disjoint passages cannot be stitched into a new quote.
- New processing blocks contain at most 1,000 characters; processing covers every block and retains original offsets. Legacy 1,200-character citation records and IDs remain unchanged.
- Curated legacy citation/check payloads stay in the citation's `legacy` snapshot and immutable history, separately from current confidence. Its raw/mapped hashes and actual synchronization actor/time are operational provenance outside the semantic evidence hash. Divergence blocks acceptance/use; resolution guards both the current bank reference and exact legacy hash, records a reason/choice and requires fresh acceptance.
- Article-only projections retain the original computed ID in `legacyCitationId` and the untouched legacy citation payload. Their bank IDs are stable per production and referenced source segment, so private curation never becomes another production's public metadata and two speakers repeating the same words retain their own attribution. Authorized alias lookup preserves the old identifier; a matching saved curation retains its original bank ID only for that exact source reference. Exact source spans preserve original whitespace/Unicode while resolving the older library's normalized presentation.
- Article provenance points to an immutable copy of the actual piece/version document, with its original metadata and separate importing actor/time. A changed partial-import document returns a conflict. Both current and earlier originals remain addressable through the evidence history; importing evidence does not invent insertion, approval or publication events.
- Citations and statistics share provenance, metadata and correction history; their payloads are discriminated. A statistic keeps raw/decimal/range/scale, unit, observation period, geography, population, qualifier, issuing institution and declaring person separately.
- The evidence snapshot hash includes all semantic fields, including attribution and qualifiers, while excluding operational timestamps. A decision uses `{id, revision, hash}`, a check revision, policy revision and preceding decision sequence.
- A metadata correction preserves literal/source identity and increments the evidence revision. Its database-authored actor/time/reason stamp remains in each historical payload and the audit, while staying outside the semantic hash. No-op changes are refused. Original-word changes require a new source version.
- No result is distinct from false. Opinions and forecasts remain attributed; factual components in mixed statements remain checkable.
- Confidence never includes use frequency, query relevance or editorial strength. The initial D10 policy requires human review and has no fabricated calibrated thresholds.
- Automatic eligibility requires an activated calibration report and thresholds for every claim kind. Disputed, pending or unvalidated factual evidence still requires a decision.
- An acceptance cannot create authorization, literal words or confirmed attribution. A changed check, policy, source or semantic payload invalidates applicability of the previous acceptance.
- Use is a persistent occurrence, not a counter increment. Selection, insertion, exact-version approval and actual publication are separate. Publication requires an actual receipt; retries/export do not invent it.
- All keys, queries, source access, decision logs, request receipts and jobs are workspace scoped. A platform inspection remains read-only.

## API and concurrency contract

The route family is `/api/reporter/memory`, within the existing same-origin/authentication/error boundary. The runtime exposes one `EditorialMemory` port; components never import infrastructure. The adapter is bound only when real handlers are implemented, never to successful fake methods.

| Operation | Contract |
| --- | --- |
| GET library | Validated `MemoryQuery`; default limit 25, maximum 100; deterministic sort and opaque cursor |
| GET detail | Current evidence/material/check/decision, eligibility, referenced original context and first bounded page of each history |
| GET evidence history | `/memory/:id/history/:checks\|decisions\|revisions\|occurrences`; immutable pages with exact snapshot/total and signed continuation, default 25/max 100 |
| GET materials/job | Bounded pages; persisted state and real completed/failed block counts |
| POST material | Validated original and metadata, explicit rights, server-owned actor/workspace and immutable job context |
| POST retry/cancel | Current authorized job, base revision for cancel, receipt-protected retry; completed blocks are retained |
| POST check | Exact current evidence snapshot; enqueue durable check, never promise provider completion synchronously |
| POST review | Any active workspace member; required reason, evidence/check/policy and preceding decision guards |
| POST correction/source revision | Required reason and expected revision; old payloads and original source remain retrievable |
| POST legacy reconciliation/resolution | Bounded authorized curated-row backfill; explicit outcomes and resumption ID; keep-bank/apply-legacy choice guards both snapshots and has actor-stamped audit |
| POST article reconciliation | `/memory/reconcile/articles`; at most 100 quote outcomes and five scanned documents per command, explicit unmatched/invalid states, partial-document resume bound to its exact stored hash |
| GET old alias/original article | `/memory/legacy/:id` returns authorized variants; `/memory/:id/article?snapshot=<hash>` retrieves a current or historical original associated with that evidence |
| POST selection | Ordered evidence snapshots; all source, decision and permission checks repeat atomically on use |
| GET policy | Active version and calibration status; policy mutation is a separate admin-controlled phase 7 contract |

All writes carry a request ID generated once per user action. Scope receipts to workspace, actor, operation and canonical payload. An identical replay returns the original result; changed payload/identity conflicts. Mutations and their audit rows commit together. No client-provided actor, workspace or score grants authority.

### Original-document readers for archive and market intake

The framework-free document reader accepts the existing TXT/MD/SRT/VTT text formats and explicit CSV/TSV dialects as UTF-8, bounded by the existing 1 MiB material capacity. It preserves the exact source text, BOM, Unicode, whitespace and line endings. Every line or table record retains original UTF-16 offsets and physical line numbers; decoded cell values are separate from their unchanged quoted source spans. Comma is the CSV default; semicolon is an explicit choice and TSV uses tabs. No header, date, institution, numeric value or formula is inferred or executed. Limits are 10,000 lines/records and 128 table columns. Invalid encoding, binary controls, malformed quoting, inconsistent columns and unsupported formats refuse the complete document with an actionable cause, rather than silently skipping content.

This reader alone does not import a material, store an original file, reconcile a batch or grant authorization. Those operations must retain original bytes/checksum and current workspace access, use the existing extraction/check/versioning contracts, and expose individual refusals and retries. PDF/DOCX/OCR and provider-specific market APIs remain separate adapters; no real format inventory or archive has been supplied.

### Private original-file API

| Endpoint | Contract |
| --- | --- |
| POST `/memory/originals` | Strict name, canonical base64 bytes and optional CSV delimiter; editor/admin capability and an action idempotency key. The server validates the UTF-8 document and computes its SHA-256, size, format and parser version. Client actor/workspace/status fields are refused. |
| GET `/memory/originals/:id` | Current metadata only. Before import, the uploader or workspace administrator may read it. A visible associated material additionally grants source readers access. Missing, private and other-workspace identities return 404. |
| GET `/memory/originals/:id/file` | Stored originals only, verified bytes, attachment disposition, private/no-store and nosniff. Access is checked before storage and again before delivery. Storage addresses and signatures remain internal. |
| POST `/memory/materials/from-file` | Explicit material title/kind/metadata/rights/origin and original-file identity. Text is read and parsed from authorized immutable storage; a client text field is refused. Existing material/source/block/job/versioning contracts apply. |

Preparation and completion have separate durable, actor-scoped idempotent receipts and audit events. Pending metadata commits before disk/S3 writes. Completion commits its stored state and actual actor/time with audit; an audit failure leaves the tracked pending state recoverable with the same upload action. No network/filesystem work holds a database transaction open. Upload alone creates no source, review, use or provider job, and does not grant source authorization.

Local publication uses a mode-0600 temporary file and an atomic link; existing originals are checked instead of replaced. Cloud objects use the existing private source bucket under a workspace/checksum namespace and a separate worker-secret gateway. That gateway has a bounded body, strict document-only commands and no arbitrary object key. Every read validates size/SHA-256. Existing image/media object policies are unchanged.

Migration 073 stores immutable metadata behind forced RLS and narrow functions. Runtime/worker roles have no direct table access. A database trigger binds a newly imported file-backed material's exact source text to the stored file checksum, including generic text-import calls; failed imports roll back their source and job. Source corrections retain the original uploaded bytes and identity while appending logical source versions. They do not rewrite the file or reassign its provenance. These single-file APIs do not yet provide batch inventory/reconciliation, cross-action material deduplication or the product file-import UI.

Cursor encodes an observed snapshot, validated query/sort identity and final stable key. Records added later do not shift an existing page sequence. Changed filters reject an old cursor. Corrections use snapshot revisions consistently or return an explicit expired cursor; never silently mix pages. `total` refers to that same authorized query snapshot. Query date field is explicit (`recorded`, `published`, `observation`); missing dates do not acquire inferred values.

All selected topics must match. Institution matches either the material publisher or the statistic issuer. Observation dates overlap known interval bounds; unknown bounds do not become inferred dates. A default, unactivated policy reports null activation actor/time. Library views expose `checkState` (missing/current/outdated/restricted) and `reviewRestricted`; a hidden latest review or stale check cannot restore eligibility from older visible state. Detail/history and review APIs preserve these rules. Review is POST `/memory/:id/review`, with `Idempotency-Key`; stale checks return 409 and inaccessible supporting evidence returns 403. Other write APIs must preserve these rules before the frontend port is bound.

Expected refusals: invalid input 422, missing resource 404, capability/access failure 403, stale snapshot/receipt/cursor 409, explicit processing/capacity limit 422 or 429, provider/configuration failure with a recoverable/terminal code. Return safe product messages and no credentials. Library responses use `Cache-Control: no-store`; no mutation happens on GET.

Examples: an approver accepting a current quotation with a written reason is valid; a read-only support session is refused. Acceptance with `previousSequence=1` conflicts if another review already created sequence 2. A current source with unknown author cannot become ready by submitting an acceptance. A 2024 figure does not conflict automatically with a 2025 figure or another geography. A request asking for unused inserted evidence does not count a mere selection as an insertion.

### Legacy duplicate consolidation

When later curation matches the exact production, source version/hash and literal anchor of an article projection, the canonical curated ID remains authoritative. An unchanged projection becomes `superseded`; its original article, corrections, reviews and occurrences stay attached to the old immutable identity. Acceptance and use events never transfer to the canonical evidence. Different productions or source segments remain separate even when their words match.

A corrected or conflicting projection remains active with `deduplication.state=pending` and cannot be accepted or selected. POST `/memory/:id/duplicate` requires the exact variant and canonical references, a reason and `keep_variant` or `use_curated`. Keeping the variant copies its mutable metadata/attribution into a new audited canonical correction; choosing current curation preserves the canonical payload. Both retire the variant and record the actor/time/choice and exact canonical snapshot. Raw legacy curation and approved article snapshots remain unchanged. Resolve any canonical legacy conflict first. Identical retries reuse one result; concurrent different choices have one winner.

Library queries default to `status=active`; `withdrawn`, `superseded` and `all` are explicit URL selectors. Status filtering uses the same historical snapshot, totals, ordering and cursor binding as every other filter. A retired variant remains accessible by its ID/history and its associated article snapshots. Legacy reconciliation cannot resurrect it or erase a pending duplicate choice.

### Ordered selections

POST `/memory/selections` persists 1–100 ordered, distinct evidence references with `baseRevision` and an optional existing selection ID. Every item must be currently usable. The server captures its applicable decision, check and policy revisions; stale evidence, pending duplicates, missing attribution/rights, hidden checks/reviews and unreviewed revisions are refused atomically. A failed item leaves no partial selection or events. GET `/memory/selections/:id` restores the saved snapshots while rechecking the target production and every material's current visibility. Original snapshots remain readable after later corrections when their scope is still accessible; reading them does not release stale evidence for use.

Creation and updates stamp the real creator, creation time, updating actor and update time in PostgreSQL, with immutable selection history and audit. The target production binding is immutable, including an initially null binding. A pre-production selection may later be referenced as an input to production creation; its original events are not rebound. Updating requires the current selection revision, and concurrent different edits have one winner. Actor-scoped retries recheck resource access before returning the original result.

Only actual `selected` events are created here. Each points to its first selection revision and exact evidence snapshot; reordering or removing/readding that snapshot does not duplicate its event. Distinct target productions and unattached selections occupy separate counting namespaces. Selection does not count as insertion, approval or publication. Writing must revalidate all current source/evidence/check/policy/decision conditions again and record its own actual occurrences in phase 6.

## Original-material revisions

POST `/memory/materials/:id/revision` requires the exact material revision and source version/hash, a complete literal original and a reason. The existing editor/admin import capability governs corrections; ordinary evidence acceptance remains open to any authenticated member. The command appends a source version with database-owned actor/time/reason, retains metadata/primary origin/file provenance and preserves all prior source versions. New text never grants source authorization. The same transaction creates a complete new extraction job, cancels/fences queued or running obsolete extraction, and records audit/idempotency receipts.

Active observations from the material gain a context revision and correction stamp. Their historical literal/semantic hash is unchanged; their previous checks, decisions, selections and article-use proofs no longer match the current revision. Historical observations are not erased or silently rewritten into the new original. Future extraction produces new records anchored to the corrected source and requires fresh review. An editor may explicitly recheck/review a historical observation against its own original; old acceptance is never automatically reused. Explicit replacement relationships and impact reads are defined below; calibration remains phase 7 work.

GET `/memory/materials/:id?revision=N` retrieves one exact historical material/source snapshot while applying current source rights and visibility. It returns one source version, not the entire accumulated original history. Revision writes recheck current visibility before replaying a receipt. Competing alternatives have one winner; source, context revisions, jobs, audit and receipt roll back together on failure. Approved article snapshots, drafts and persistent use counts never change as a side effect.

## Correction impact read contract

GET `/memory/materials/:id/impact` and `/memory/:evidenceId/impact` return the currently visible saved selections and non-archived productions that still reference an earlier evidence revision/hash or a withdrawn/superseded record. Selection rows count distinct changed evidence. Production rows distinguish stale items in the latest attached collection from stale items actually referenced by current article-draft segments, including earlier collection versions. Refreshing a collection alone therefore cannot hide a remaining old draft reference. Immutable article versions and historical-use totals are not treated as editable impact targets.

These are advisory reads, not a statement that every other writing/check/policy gate is satisfied. They return only target metadata/counts, never entire originals or article bodies, and create no use, receipt, decision or provider work. Current material/evidence and production visibility apply before pagination. Default/max page size is 25/100. Signed cursors bind actor, tenant, workspace, scope, size and visibility; any bank-clock or editorial-clock change invalidates the continuation instead of mixing current drafts across snapshots. A changed semantic proof remains flagged until explicit editor recovery; updating unchanged references cannot automatically accept a different proof.

## Explicit evidence replacement

POST `/memory/:id/replacement` requires editor/admin access, two exact evidence references, a reason and an idempotency key. Both records must be active, visible and of the same kind, with no pending duplicate choice. A corrected citation must reference a later version of the same original. Statistics may retain distinct original sources and observation periods. The successor must resolve against its currently authorized material source.

Migration 069 stores an immutable, separately authorized relationship. The predecessor becomes superseded; both records gain a context revision, invalidating their old reviews/checks without changing literal content, anchors, numeric values, periods or source provenance. No acceptance, article occurrence or publication count transfers. Pending checks are cancelled and fenced. A new independent review is required before future selection/writing; frozen articles, existing collections and current drafts are never rewritten.

Each record has at most one predecessor and one successor. Chains are allowed; cycles, merges and competing successors are refused. Both endpoint visibility checks apply to receipt replay and relation reads. Public evidence contains only a generic correction stamp: neither a private counterpart ID nor the relation's free-text reason leaks through evidence/history. GET `/memory/replacements/:id` returns the exact immutable after-snapshots and actual actor/time/reason only when both endpoints remain visible. Later corrections cannot rewrite that comparison.

## Editorial feedback dataset

Migration 070 projects existing and future audit events into an append-only feedback table. Corrections include metadata, revised originals and explicit replacements. Rejections retain the editorial action, without asserting factual falsity. Resolved conflicts distinguish an explicit disputed-check acceptance, legacy reconciliation and manual duplicate choice. Automatic imports and ordinary acceptance are not feedback labels. Every event retains actual actor/time/reason, exact before/after evidence references, original version, applicable check/policy and related proof where present. Backfill/replay uses the original audit ID and cannot duplicate an event. Capture and the originating correction/decision/audit share one transaction.

GET `/memory/feedback` supports `kind`, `evidenceId`, `materialId`, `cursor` and `limit`. Default/max row limits are 25/100; a page stops at 256 KiB of stored event JSON and provides a continuation without discarding remaining records. Signed cursors bind actor/workspace/visibility/filter/limit and reject a changed bank snapshot. Visibility rechecks current access to all affected endpoints, historical selection context, decisions and check supports. A private counterpart or check cannot leak through a public target's feedback, counts or cached write receipt. Reads create no decision, audit event, provider job or use count.

POST `/memory/feedback/relevance` accepts an exact saved selection revision and evidence reference, `useful` or `not_useful`, and a required reason. Any member with `library.review` may submit it with an idempotency key. The server retrieves the saved query and proof, including historical selection/evidence revisions after later edits; clients cannot choose actor, policy, source or query. Current rights are checked again before receipt replay. This observation never changes factual acceptance, confidence, sources, article drafts or occurrence counts.

GET `/memory/feedback/relevance-context` takes the five explicit selection/evidence proof fields and returns only the selected historical evidence, its original-version reference, saved query and visible material/pauta metadata. It never returns unrelated original segments or other selected excerpts. These outcomes are an evaluation dataset, not calibrated truth labels. Evaluated policy proposal/comparison/activation/rollback remains a separate unfinished phase-7 contract.

## Evaluated confidence engine

Calibration annotations are explicit factual outcomes (`confirmed`, `contradicted`, `insufficient`) on an exact evidence/check/original snapshot. They are separate from editorial rejection, correction and pauta relevance. A case records its declared technical/editorial purpose and actual reviewing actor. Candidate policies select frozen cases into training and validation with explicit thresholds, minimum case/original/release counts, permitted errors and a required measured precision bound. These are configuration inputs, never inferred from popularity or fabricated defaults.

Version `independent-confirmation-v1` scores only verified independent confirmations of every factual claim. Same-publisher mirrors, identical excerpts, unverified origins, contradictions and unsupported claims cannot supply a scoring bin. Training and validation may share neither an original source ID nor a primary origin. Correlated annotations of the same original form one group; a group with any adverse label is adverse. Training-group agreement uses the lower endpoint of a two-sided 95% Wilson interval, conservatively floored to an integer score. Validation reports raw outcomes and original-group lower bounds separately. Formula reference: [NIST/SEMATECH proportion intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). This measures agreement with the selected reviewed corpus, not the probability that a new assertion is true.

Technical cases cannot activate a calibrated policy. Unknown bins and unmeasured checks retain null confidence and require review. Opinions/forecasts remain outside this factual scorer. Source rights, literal/authorship/conflict guards and exact revision matching still apply independently of a score. Manual-review policies need no fabricated calibration criteria. Activation and restoration always produce a new policy revision, retaining the previous snapshot. Persistence, controlled administration and integrated acceptance are required before this lifecycle is delivered.

## Evaluated policy lifecycle

Migration 071 stores immutable factual annotations and evaluated proposals with workspace isolation. POST `/memory/policy/cases` records an explicit `confirmed`, `contradicted` or `insufficient` annotation against the exact current evidence/check/original and policy revision. Any reviewing member may annotate; actor/time and source-derived fields belong to the server. Editorial feedback is never converted into truth labels. Exact normalized statements and shared verified supporting originals join the source sampling groups, including canonical external URLs without tracking parameters; repeated records cannot create independent training/validation observations.

Administrators propose explicit settings, thresholds, criteria and training/validation case assignments through POST `/memory/policy/proposals`. GET of the proposal retains the frozen baseline and evaluated comparison, including coverage, errors, original-group counts, uncertainty and activation blockers. No client-supplied metrics or confidence map is accepted. GET `/memory/policy/cases`, `/proposals` and `/versions` use signed, actor/workspace/resource/size/visibility-bound pages, with default/max 25/100 rows and a 256 KiB payload budget. Reads create no event, receipt or provider work. Public current-policy and evidence/context reads omit private calibration counts.

POST `/memory/policy/proposals/:id/activate` requires the current baseline revision, a passed report, current access/authorization to the complete evaluated corpus, an explicit reason and administrator permission. Concurrent alternatives settle one revision; replay is scoped and audited atomically. Queued/running checks are cancelled and fenced, previous check/review proofs become outdated, and future checks use the activated mapping. Sources, drafts, frozen article versions and use events are retained. POST `/memory/policy/restore` creates a new evaluated proposal from an old policy, then requires separate activation; it never rewinds the database or removes newer data. Administrative UI and complete rendered acceptance remain required.

## Reapplying a policy to saved checks

Migration 072 allows an explicit editor/administrator POST `/memory/:id/reassess-policy` with exact evidence/check references, the current target policy revision and a required reason. Only a policy change is reusable: the original, complete semantic evidence revision/hash, source version and all current internal-support proofs must still match and remain authorized/visible. A pending/running fresh check takes precedence. Changed originals, values, dates, attribution, supporting records or permissions require the appropriate new check/review instead of silently reusing an old result.

Reapplication appends a check revision with recalculated confidence and the new policy revision. Literal claims, verdict, saved support, provider/model, editorial strength and original `checkedAt` stay identical. Separate `policyEvaluation` metadata records the preceding check/policy, actual operator, time and reason. It creates no provider work, queue job, use event or editorial decision; existing decisions and selected/article snapshots retain their own old proof and cannot authorize a changed check. Manual policies and unmeasured/disputed/unsupported bins retain null confidence.

Fresh worker completions and saved-check reapplications share the same persistence confidence guard: a numeric value must belong to the active measured mapping for that exact policy, with validated factual claims and independent verified confirmation. Manual or unsupported values remain null, and invented scores are rejected. A fresh provider check retains the job's exact model/fence contract and cannot inherit old `policyEvaluation` metadata.

The operation and audit/receipt share one transaction. Concurrent attempts settle one new check revision; replay rechecks access to the historical proof and current source authorization before returning its saved receipt. IDs and request keys remain isolated by workspace/actor. Detail reads expose an advisory `policyReassessment` proof only when currently applicable, without private calibration counts or write-side effects. The interface requires a reason, keeps a failed form through explicit context refresh and exposes an immutable result reader; rendering must retain keyboard focus when the check changes.

## Phase 1 verification

`src/domain/editorial-memory.test.ts` covers every workspace role, audit identity, missing/foreign/read-only membership, reason requirements, optimistic revisions, stale acceptance, source withdrawal, unknown authors, fabricated quote text, conservative D10, numeric score bounds and contiguous original anchors. `src/domain/permissions.test.ts` covers the complete role/capability matrix including `library.review`.

These tests establish executable domain contracts. They do not prove implemented database isolation, frontend accessibility, provider quality or a production release. Those gates remain with phases 2–9.
