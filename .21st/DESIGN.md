# Project Design Context

## Project

- Name: Reporter IA
- Product type: Editorial workflow SaaS
- Stack: Next.js and React
- Color mode: Light
- Density: Compact

## Source of truth

- Visual components: `@content-ventures/design-system/v3`
- Icons: `@content-ventures/design-system/v3/icons`
- Theme and typography: `ThemeV3` and `interV3`
- Product rules: `docs/DEVELOPMENT_HARNESS.md`

## Required composition

- Application frame: `AppShell → Sidebar + TopBar + content`
- Structured content: `Panel → Section → content`
- Navigation uses the public DS menu, search, account, notification and command palette components.

## Constraints

- Use only public Design System exports for visual UI.
- Search the Design System before composing a product component.
- Do not add local visual primitives, CSS modules, tokens, fonts, icons, themes or substitute UI libraries.
- Preserve the spacing and responsive behavior owned by structural components.

## Current decisions

- The visible product menu contains only routes available in the current release.
- The DS shell is ready to receive new route groups as later releases are implemented.
