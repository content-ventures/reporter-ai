# Changelog

All notable changes to Reporter IA are documented in this file. Release entries are generated from validated English Conventional Commits.

## [Unreleased]

### Added

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
