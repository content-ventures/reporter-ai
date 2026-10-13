# Changelog

All notable changes to Reporter IA are documented in this file. Release entries are generated from validated English Conventional Commits.

## [Unreleased]

### Added

- Added the connected Citações library with literal transcript verification, source/version/time
  traceability, explicit author confirmation, editorial relevance and searchable curated entries.
  Generated article quotations are emphasized without rewriting their text.

- Connected automatic Pixabay article illustration to private server assets and the existing
  editor/export ports. Original-resolution requirements and provider access limitations remain
  explicit; missing images never discard a valid article or silently use reduced previews.

- Added six Seafood-inspired carousel creatives in the Notícia, Explica and Podcast families,
  with real editable layouts, template-specific illustrative previews, shared writer selection
  and safe model switching that retains text and reports overflow. Existing model IDs remain available.

- Connected OpenAI Responses and Claude Messages alongside Groq transcription, with explicit
  per-stage provider selection, safe credential aliases, exact editable prompts and call provenance.

- Added editable material analysis for source-grounded internal titles and presented participants,
  with literal evidence and human confirmation, without inventing audio speaker attribution.

- Added a design-system prompt configuration page backed by PostgreSQL revisions and immutable
  per-job snapshots. Connected Make-inspired sequential article writing, optional evidence curation,
  editable model parameters, safe template variables and actual call traces to the existing UI.

- Connected the approved UI to private uploads, Groq transcription, reviewed outlines, article
  generation, exact-version manual approval and template-constrained carousel copy.
- Added isolated PostgreSQL bootstrap, a durable worker and a server-owned rich-editorial aggregate
  without login or external platform dependencies.

- Added the development harness, repository policies, local hooks, and continuous quality gate.
- Added controlled release foundations and the public version-history experience.
- Added the R1 · Experiência screens on a local simulation: overview, productions, new production, material, article studio, review, carousel, delivery, and the admin-only read-only Logs (F1.7).
- Added the typed domain, the ports with contract suites, the local simulated adapters (store, generation, render, export, assets, audit), and a single runtime composition root.
- Added deterministic simulated generation with live steps, stop, scripted failures, retry from a saved run, and the "Simulação local" model shown once per surface.
- Added run leases between tabs: a reload or a new tab never interrupts a generation; the run continues in place, and another tab takes it over only when its tab is gone.
- Added the article studio on Tiptap and the Design System Prose: inline AI suggestions decided with ⌘↵ and Esc, quote checks against the transcript, AI block review, a copilot with persisted votes, versions, and ⌘S.
- Added carousel copy derived from the approved article, with line limits measured on the render, a template catalog, and a PNG per slide.
- Added the delivery package (Markdown, HTML, carousel JSON, manifest, and slide PNGs) with traceability and pilot feedback.
- Added simulated access control: a restricted production, "Entrar como", and approval disabled with its reason for members without the role.
- Added browser persistence with `?reset=1`, recovery of interrupted runs, and read-only protection for a tab that lost a write race.
- Added the "Em preparação · R1 · Experiência" block to Novidades, validated by the version policy.
- Added architecture and source-ban policies: layer boundaries, and no local class names, inline styles, lowercase markup, DOM creation, or editor node views.
- Added the Playwright smoke (`pnpm smoke`): the main path (counting the downloaded files) and a route sweep at 1440 and 390 pixels (touch on the phone) that also checks a single `h1` and no skipped heading level, with its own CI job on the quality job's build.
- Added "Desfazer" after discarding an AI suggestion (`decideSuggestion(id, 'restore')`).
- Added the whole R1–R7 map to the sidebar: items of a later release show "Em breve" with no link, and their tip says what the screen will do and which release brings it. ⌘K, the active item and the trail list only released items; Administração items show only to admins.

### Changed

- Kept successful production writes successful when a subsequent refresh fails, reused identical
  ambiguous command retries, and validated outline references/titles before provider caching.
  A failed optional length refinement now retains an already-valid R1 article; invalid articles
  are still rejected rather than truncated or accepted below the required limits.

- Kept enlarged carousel previews entirely within the viewport, reserving room for the dialog
  header and mobile footer. Centered the page counter with its arrows using the existing DS footer;
  full-resolution preview images and saved carousel content remain unchanged.

- Refined the six Seafood carousel creatives with optical headline fitting, balanced line breaks,
  intentional photo crops, lighter signatures and legible quotation layouts. Added sharper library
  previews and an accessible enlarged-page viewer without changing saved copy, model IDs or exports.

- Prevented provider event replay from appending regenerated articles or autosaving replayed text
  as a human edit; the editor adopts validated server drafts without altering its layout.
- Fixed automatic adoption of completed articles in an empty editor, preserving unsaved human
  changes and provenance. Added complete-sentence contracts and visible concise-writing prompts
  so paragraph/slide body length limits do not accept unfinished generated prose.
- Exposed actual outline progress and bounded provider quota waits instead of opaque loading.
- Allocated article character budgets before each writing stage and validated paragraph contracts
  before checkpointing, without truncating generated prose or changing the approved design.

- Aligned long-source provider contracts with runtime limits, validated outputs before caching,
  and shortened whole-episode passages to avoid overflowing the facts contract.
- Reused the existing form-row spacing for the optional brief details, removing the border-adjacent divider.

- Moved the toolchain to Node.js 24.
- Rewrote the README in Portuguese for R1 · Experiência and updated the development harness: rebase-only merges, repository setup within GitHub Free, and the Design System update and acceptance build procedures.
- Redirected `/versions` to `/whats-new`.
- Made the article cover optional: no cover is a neutral "Sem capa" fact outside the readiness count.
- Fixture scripts answer only their original brief: an edited brief regenerates from the material, and the length field says when the material cannot reach the target.
- The simulated headline no longer depends on the random pick of key quotes, so the "Como o artigo nasce" preview shows the title the draft gets; the sample interview reaches Curta, Média and Longa within ±10%.
- Carousel copy: titles never end on a dangling attribution or an open quotation, the context slide takes the working title instead of a label, the quote slide carries a quotation that stands alone, the editoria includes "Tendências", and the start page preview uses the same rules as the run.
- Slide PNGs and their line fit use the Design System's Inter face instead of a system fallback.
- Material and Entrega share the studios' docked frame, so the header line sits at the same place on every stage; a blocked stage opened by its address reads as blocked.
- The suggestion and quotation bars sit in room the block opens under itself and never cover a line; a read-only tab disables the editor, the copilot, the suggestion actions and sending.
- Only files actually handed to the browser are recorded as delivered.
- List timestamps keep the date and the time on one line ("29/09 · 01:30" never wraps after the dot).

### Removed

- Removed the R1 interface preview built on in-memory React state.

## [0.1.0] - 2026-10-06

### Added

- Initialized Next.js 16, React 19, TypeScript, App Router, pnpm 10, and the Node.js runtime contract.
- Connected the public Content Ventures Design System V3 API, theme, typography, components, and icons.
- Published the R0 foundation dashboard without introducing R1 editorial features.
