# Project Design Context

## Project

- Name: Reporter IA
- Product type: Editorial workflow SaaS
- Stack: Next.js and React
- Color mode: Light
- Density: Compact
- Copy: Brazilian Portuguese

## Source of truth

- Visual components: `@content-ventures/design-system/v3` (0.2.0, branch `editorial-studio`, until it is tagged and pinned)
- Icons: `@content-ventures/design-system/v3/icons`
- Theme and typography: `ThemeV3` and `interV3`
- Product rules: `docs/DEVELOPMENT_HARNESS.md`

## Required composition

- Application frame: `AppShell → Sidebar + TopBar + content`
- Structured content: `Panel → Section → content`
- List pages: `PageHeader → FilterBar → DataTable → Pagination`, details in a `Drawer`; Logs adds a `MetricStrip` below the filters
- Production stages: `PageHeader variant="frame"` with the title, status, `Stepper`, stage actions and the overflow menu on one line
- Studios: `AppShell bleed → WorkspaceLayout docked` (source | text | copilot), a `Toolbar` ending in `SaveIndicator`, and the document in `Prose`
- Creation pages: `FixedFrame` with the form, a live preview aside and the action footer
- Navigation uses the public DS menu, search, account, notification and command palette components.

## Constraints

- Use only public Design System exports for visual UI; a missing piece is added to the DS first, with a specimen and a test.
- No local CSS, class names, inline styles, lowercase markup, DOM creation or editor node views in Reporter.
- In-document markers are `data-*` hooks styled by `Prose` and widgets from the DS `proseWidgets` factory.
- Tooltips come from the DS `Tooltip`, never the native `title`.
- No decorative side borders or per-paragraph boxes.
- Hover never scrolls the transcript; the paragraph-to-source link follows the caret.
- Content density: no filler copy, one supporting layer per header, buttons start with a verb.

## Current decisions

- The sidebar shows the whole R1–R7 product map. Items of a later release use the DS `NavItem.soon` ("Em breve", no link, the reason in the tip: what the screen will do and which release brings it); ⌘K, the active item and the trail use released items only. Role filtering comes first: Administração items show only to admins, even as "Em breve".
- Studios use the full width with one line of chrome above the text.
- Status colours are reserved for state; meters and sparklines are neutral by default.
- Every AI output carries the "Simulação local" label while the product runs on the local simulation.
- The writer overview is based on `release-one-experience`: a photographic card resumes the real next action beside the original personal/team queues. Preserve every R1 screen, route and workflow state. See `docs/EDITORIAL_OVERVIEW.md` for scope and references.
- The user selected an editorial, visual overview with stories in focus. Use real article headlines and openings, images already present in the article, a prominent story to continue and a delivery-stage story to read. The original priorities and stage filters remain; recent activity is secondary and collapsible. No new workflow state is introduced.
- Story previews use compact, equally sized cards with short headlines and openings. The DS ListItem truncates each with ellipses; cards have no internal scroll areas, and metadata/actions stay aligned. The separately requested “Escrever do zero” entry opens an empty article in the existing studio alongside transcript creation.
