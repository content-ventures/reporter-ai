# Editorial memory contract

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
- Citations and statistics share provenance, metadata and correction history; their payloads are discriminated. A statistic keeps raw/decimal/range/scale, unit, observation period, geography, population, qualifier, issuing institution and declaring person separately.
- The evidence snapshot hash includes all semantic fields, including attribution and qualifiers, while excluding operational timestamps. A decision uses `{id, revision, hash}`, a check revision, policy revision and preceding decision sequence.
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
| POST selection | Ordered evidence snapshots; all source, decision and permission checks repeat atomically on use |
| GET policy | Active version and calibration status; policy mutation is a separate admin-controlled phase 7 contract |

All writes carry a request ID generated once per user action. Scope receipts to workspace, actor, operation and canonical payload. An identical replay returns the original result; changed payload/identity conflicts. Mutations and their audit rows commit together. No client-provided actor, workspace or score grants authority.

Cursor encodes an observed snapshot, validated query/sort identity and final stable key. Records added later do not shift an existing page sequence. Changed filters reject an old cursor. Corrections use snapshot revisions consistently or return an explicit expired cursor; never silently mix pages. `total` refers to that same authorized query snapshot. Query date field is explicit (`recorded`, `published`, `observation`); missing dates do not acquire inferred values.

All selected topics must match. Institution matches either the material publisher or the statistic issuer. Observation dates overlap known interval bounds; unknown bounds do not become inferred dates. A default, unactivated policy reports null activation actor/time. Library views expose `checkState` (missing/current/outdated/restricted) and `reviewRestricted`; a hidden latest review or stale check cannot restore eligibility from older visible state. Detail/history and review APIs preserve these rules. Review is POST `/memory/:id/review`, with `Idempotency-Key`; stale checks return 409 and inaccessible supporting evidence returns 403. Other write APIs must preserve these rules before the frontend port is bound.

Expected refusals: invalid input 422, missing resource 404, capability/access failure 403, stale snapshot/receipt/cursor 409, explicit processing/capacity limit 422 or 429, provider/configuration failure with a recoverable/terminal code. Return safe product messages and no credentials. Library responses use `Cache-Control: no-store`; no mutation happens on GET.

Examples: an approver accepting a current quotation with a written reason is valid; a read-only support session is refused. Acceptance with `previousSequence=1` conflicts if another review already created sequence 2. A current source with unknown author cannot become ready by submitting an acceptance. A 2024 figure does not conflict automatically with a 2025 figure or another geography. A request asking for unused inserted evidence does not count a mere selection as an insertion.

## Phase 1 verification

`src/domain/editorial-memory.test.ts` covers every workspace role, audit identity, missing/foreign/read-only membership, reason requirements, optimistic revisions, stale acceptance, source withdrawal, unknown authors, fabricated quote text, conservative D10, numeric score bounds and contiguous original anchors. `src/domain/permissions.test.ts` covers the complete role/capability matrix including `library.review`.

These tests establish executable domain contracts. They do not prove implemented database isolation, frontend accessibility, provider quality or a production release. Those gates remain with phases 2–9.
