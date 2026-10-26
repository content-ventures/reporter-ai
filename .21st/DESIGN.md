# Project Design Context

## Project

- Name: Reporter IA
- Product type: Editorial workflow SaaS
- Stack: Next.js and React
- Color mode: Light
- Density: Compact
- Copy: Brazilian Portuguese

## Source of truth

- Visual components: `@content-ventures/design-system/v3` (0.4.0, pinned at `0479b31c567653c76b93ec2ec89eb6976ce31172`)
- Icons: `@content-ventures/design-system/v3/icons`
- Theme and typography: `ThemeV3` and `interV3`
- Product rules: `docs/DEVELOPMENT_HARNESS.md`

## Required composition

- Application frame: `AppShell → Sidebar + TopBar + content`
- Structured content: `Panel → Section → content`
- List pages: `PageHeader → FilterBar → DataTable → Pagination`, details in a `Drawer`; Logs adds a `MetricStrip` below the filters
- Production stages: `PageHeader variant="frame"` with the title, status, the journey `Menu` ("Artigo · 2 de 5"), stage actions and the overflow menu on one line, and no `back`
- Studios: `AppShell bleed → WorkspaceLayout docked` (source | text | copilot), a `Toolbar` ending in `SaveIndicator`, and the document in `Prose`
- Creation pages: `FixedFrame` with the form, a live preview aside and the action footer
- Navigation uses the public DS menu, search, account, notification and command palette components.
- Page navigation is the `TopBar` trail only (breadcrumbs): every level but the current one is a link. Nothing uses `PageHeader back` or another back link.

## Constraints

- Use only public Design System exports for visual UI; a missing piece is added to the DS first, with a specimen and a test.
- No local CSS, class names, inline styles, lowercase markup, DOM creation or editor node views in Reporter.
- In-document markers are `data-*` hooks styled by `Prose` and widgets from the DS `proseWidgets` factory.
- Tooltips come from the DS `Tooltip`, never the native `title`.
- No decorative side borders or per-paragraph boxes.
- Hover never scrolls the transcript; the paragraph-to-source link follows the caret.
- Content density: no filler copy, one supporting layer per header, buttons start with a verb.

## Current decisions

- Source discovery uses the client publication only as coverage context. Seafood Brasil is a client, not a source to ingest for its own newsroom. Exclude the client's domain and subdomains from discovery and show real publisher favicons with public DS BrandMark throughout source suggestions and the news radar.

- The sidebar shows the whole R1–R7 product map. Items of a later release use the DS `NavItem.soon` ("Em breve", no link, the reason in the tip: what the screen will do and which release brings it); ⌘K, the active item and the trail use released items only. Role filtering comes first: Administração items show only to admins, even as "Em breve".
- Studios use the full width with one line of chrome above the text.
- Navigation is always by breadcrumbs (João, October 16, 2026). Every production stage shows "Produções › <título da produção> › <etapa>" (Material, Artigo, Aprovação do artigo, Carrossel, Aprovação do carrossel, Entrega); the title opens the stage the production is on, and deciders start at Produções too. Overlays and drawers add no level. `scripts/check-content-density.mjs` rejects `PageHeader back`. Recovery actions inside error and access states ("Ver produções") and in-flow steps ("Voltar às aprovações") stay. On phones the DS TopBar will show the first and the current level (DS change pending; until it is pinned, phones show only the current level); Reporter adds no in-page breadcrumb.
- Status colours are reserved for state; meters and sparklines are neutral by default.
- Every AI output carries the "Simulação local" label while the product runs on the local simulation.

- Início uses the user-approved editorial dashboard direction: a featured production with its next action, recent production cards, a right column for pending actions and stage counts, and visual carousel model previews. On phones, pending actions follow the feature and model previews use a compact two-column grid. Keep Nova produção, Escrever do zero and Abrir kanban accessible; preserve permissions, data and period selection. Use public DS components only and keep this revision local.

- Prompt management starts with uniform large worker cards. Each opens its ordered flow; clickable prompt nodes open the editor. The header identifies the current worker, and reload/activation actions stay inside it. Shared instructions appear within workers. Article and carousel remain separate; conditional and on-demand stages are explicit.

- The user requires R2 UI previews inside the existing workspace navigation alongside Início, Produções and Modelos, not in a separate prototype app. Publish the explicitly labeled R2 demonstration navigation and screens alongside R1, as approved on October 15, 2026; keep domain/worker release gates on R1 and all R2 interactions demonstrative. Preserve the shared header, account, breadcrumbs, command palette and admin-only CMS access. Review before integrating into existing production editors or delivery.
