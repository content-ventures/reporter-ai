# Reporter IA development harness

This document defines the mandatory workflow for human and AI-assisted development. All repository-facing names and messages are written in English. Product copy may remain in Brazilian Portuguese.

## Branches

- Work on a branch. The local `pre-push` hook blocks direct pushes to `main`; on the current plan it is the only branch protection (see Repository setup).
- Use a short English description in kebab-case, with no slash: `development-harness`, `version-history`, `transcription-review`.
- Never identify the coding agent, tool, model, or environment in a branch name. Names such as `codex/...`, `cloud/...`, `claude-...`, or `copilot-...` are invalid.
- A branch describes only the outcome being worked on.

## Commits

- Use Conventional Commits in English: `type(optional-scope): clear action`.
- Allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.
- Keep each commit cohesive and medium-sized. The automated limit is 20 files and 800 changed lines, excluding dependency lockfiles.
- Split unrelated concerns and independently reviewable changes into separate commits.
- Do not manufacture tiny commits solely to bypass the limit.

## Pull requests

- Open one PR when the work session or complete delivery is ready for review.
- Do not open a PR for every edit or intermediate commit.
- An earlier PR is acceptable only when collaboration, an architectural decision, or an urgent review genuinely requires it.
- Use a Conventional Commit title in English. The PR body must explain the outcome, validation, Design System usage, release impact, and any deployment consideration.
- Merge PRs with rebase only, to keep a linear history of the validated commits. Squash would fail the per-commit size check on the push to `main`, and a merge commit fails the Conventional Commit check.

## Design System

- Build all visual UI from public exports of `@content-ventures/design-system/v3` and `@content-ventures/design-system/v3/icons`.
- Search the Design System before composing a product-specific component.
- Do not create local visual primitives, tokens, fonts, icons, themes, color values, or substitute UI-library components.
- Product components may compose public Design System components without recreating their visual behavior.
- Local CSS is rejected by default. A future exception requires explicit technical review and must use only public Design System tokens.
- Writing studio correction (October 6, 2026): the user requires the Design System contract for every product component. The earlier editor exceptions are revoked: no local CSS Modules or native JSX UI exceptions. Editor actions, fields, source excerpts, suggestions, block lists, reordering, menus and page layout compose public V3 components without custom skins. Tiptap has no node views: the document is styled by the Design System `Prose` component, and serialized user formatting remains document data. Do not introduce decorative colored side borders or per-paragraph frames. AI actions remain labeled simulations in the frontend-only R1 preview.
- Editor boundary: Tiptap is logic only (schema, commands, plugins). No node views (`ReactNodeViewRenderer`, `NodeViewWrapper`, `addNodeView`); document styling comes from the DS `Prose` component; in-document markers are attribute-only marks or decorations styled by `Prose` data hooks; previews and actions render outside the document in DS overlays.
- Product code creates no DOM and resolves no CSS: `document.createElement`, `innerHTML`, `dangerouslySetInnerHTML`, `getComputedStyle`, `.style` mutation, `style` props, literal classes and `<style` strings are rejected in `src/`. Any DOM factory belongs to the Design System.
- AI actions remain labeled simulations ("Simulação local") in the frontend-only R1 preview: on the model chip, in provenance and on every AI output (suggestions, title cards, carousel copy). Simulated runs never show invented usage or cost.
- A page `PageStack` must not contain adjacent open `Section` components. Both own vertical rhythm, causing additive gaps. Compact sidebar groups use `Panel → Section`; related controls use `FieldGroup`, and actions stay within their section.
- Preserve the documented component composition because structural components own spacing. Use `Panel → Section → content`, or a standalone `Section variant="panel"`; never place visual content directly inside `Panel`.
- Removing copy must remove only content props or text. Do not remove a Design System wrapper until its layout role has been checked in the public component contract.

## Architecture

The R1 preview is front-end only, built once and plugged later: screens sit on a typed domain and port interfaces, implemented now by a local simulated adapter. `pnpm harness:architecture` enforces the layering:

- `src/domain` and `src/ports` are framework-free `.ts`: no React, Next, Design System or `@/` imports; only relative `.ts` imports inside `domain`/`ports`. Port contract suites (`src/ports/**/*.contract.ts`) and tests may also import `node:test` and `node:assert`.
- `src/adapters` and `src/fixtures` are imported only by `src/runtime` and tests. `src/runtime/create-runtime.ts` is the single composition root.
- UI layers (`src/app`, `src/components`, `src/features`, `src/ui`, `src/editor`, `src/state`) never import `src/adapters` or `src/fixtures`.
- Only `src/state` and app layout-level providers (`src/app/**/layout.tsx`, `providers.tsx`) import `src/runtime`.
- Modules in `domain`, `ports`, `adapters`, `fixtures`, `registries` and `runtime` use relative imports with the `.ts` extension so `node --test` runs them without a build step.
- Registries gate by release (`since`); screens read the entries of `CURRENT_RELEASE`. The sidebar is the one place that shows later releases: `menuFor` returns the whole R1–R7 map, and items of a later release render as the DS `NavItem.soon` ("Em breve", no link, a tip with what the screen will do and which release brings it). Their routes do not exist until the release ships. `navigationFor` (⌘K "Ir para"), the active item and the trail use released items only. Role filtering comes before "Em breve": a member never sees an item their role will not open.

## Content density

- Start with the shortest complete interface. A title, label, or value stands alone unless supporting copy is necessary.
- Add text only when it enables a decision or action, communicates a relevant state or consequence, or resolves an ambiguity the interface cannot resolve visually.
- Do not add an eyebrow, subtitle, metadata row, hint, notice, or explanatory section merely to fill space or make a page appear complete.
- A page header may use at most one supporting layer: `eyebrow`, `description`, or `meta`. Status is separate and must represent a real state.
- Alerts are reserved for actionable, exceptional, or time-sensitive information. They must not explain the page or repeat adjacent content.
- Metric hints clarify period, unit, source, or exception. They must not restate the metric label or value.
- Avoid nested framing such as title → subtitle → notice → section title when one clear heading is enough.
- Release summaries and change descriptions remain required because they provide the audit trail, but each change should be stated once.
- During review, remove supporting copy first. Restore only the text whose absence creates a concrete comprehension or action problem.
- Copy reduction must not change spacing, padding, hierarchy, or responsive behavior.

## Quality gates

The toolchain runs on Node 24 (`.nvmrc`, `engines`, CI and `@types/node`). The hooks are installed by `pnpm install` and can be restored with `pnpm harness:setup`.

- `commit-msg` validates commit structure and English phrasing.
- `pre-commit` validates commit size, Design System boundaries, layering and content density.
- `pre-push` blocks direct `main` pushes, validates the branch, and runs the complete gate.
- `pnpm gate:quick` runs Design System, architecture, content-density and version policies, lint, types, and tests.
- `pnpm test` runs `node --test` on `scripts/**/*.test.mjs` and `src/**/*.test.ts`. Node 24 strips types natively, so tests use erasable TypeScript only (no enums, namespaces or parameter properties; `import type`), which `tsc` enforces with `erasableSyntaxOnly`.
- `pnpm gate` adds a production build and is the required release and CI gate.
- `pnpm smoke` runs the Playwright smoke in `e2e/`: the main path (transcript → speakers → authorisation → generation → edit → send → approval → carousel → approval → export package, counting the files that reach the browser) and a sweep of every route at 1440 and 390 px (the phone as a touch device), failing on any console error, page-level sideways scroll, more than one `h1` or a skipped heading level. "Loaded" means no DS `[data-skeleton]` and no busy region. It reuses a server already listening on `localhost:3000` (usually `pnpm dev`); with none, and in CI, it builds and runs `next start` (`SMOKE_PREBUILT=1` skips the build). `SMOKE_BASE_URL` points it at another running build. Install the browser once with `pnpm exec playwright install chromium`.
- CI runs two jobs in the `Quality gate` workflow: `quality` (commit policy and `pnpm gate`, which keeps its production build as an artifact) and `smoke` (after `quality`: `pnpm smoke` on that same build, Chromium cached by lockfile, traces of failed tests kept as an artifact).

The gate is intentionally compact. It must stay fast enough for every push while covering repository policy, static correctness, automated tests, and production compilation. The smoke stays under about a minute on a warm server: add a route to the sweep or a step to the main path, not a new long scenario.

## Deployments and releases

- Production deployment is a deliberate release action, never a side effect of every commit or branch push.
- A release may start only from an approved, clean `main` after `pnpm gate` passes.
- The release process updates the version, description, changelog, and public version history together before deployment.
- Configure the production provider to deploy only version tags created by the controlled release workflow. Preview deployments should be disabled unless explicitly requested for a review.
- Do not open an automatic release PR for each change. Unreleased commits remain grouped until the delivery is ready.

The release automation and SemVer mapping are documented with the version-history implementation.

## Semantic versioning

- `X` is the commercial roadmap release: R1 ships as v1.0.0, R2 as v2.0.0, through R7 as v7.0.0.
- `Y` increments when a significant, independently valuable feature is delivered inside the current roadmap release.
- `Z` increments for bug fixes, corrections, and small maintenance improvements.
- R0 uses the pre-commercial `0.Y.Z` range while the product foundation is being established.

`pnpm release:prepare -- --bump <major|minor|patch> --roadmap <R0-R7> --summary "English summary"` updates `package.json`, `CHANGELOG.md`, and `src/data/release-history.json` together. It derives detailed changes from validated commits since the previous version.

## Controlled release workflow

The `Controlled release` GitHub Action is manual, runs only from `main`, and does the following in order:

1. Runs the complete quality gate on the approved source.
2. Calculates the next valid SemVer and generates release descriptions from commits.
3. Runs the complete gate again against the prepared release.
4. Creates one release commit, an annotated version tag, and a GitHub release.
5. Hands the tagged artifact to the future production-deployment step.

The repository currently has no production provider configuration. Production deployment is intentionally disabled until a provider is selected and its step is reviewed. When added, it must run after release preparation and deploy only the version tag created by this workflow.

## Repository setup

The repository is private on GitHub Free. That plan offers no branch protection, required status checks or environment protection rules for private repositories, so the setup is limited to what it allows:

- Pull requests: allow only "Rebase and merge" (squash merging and merge commits off).
- Branch protection: the local `pre-push` hook (installed by `pnpm install`, restorable with `pnpm harness:setup`) blocks direct pushes to `main` and runs `pnpm gate`. The `Quality gate` checks are reviewed on every PR before merging; nothing enforces them on the server.
- Releases: the human approval is the manual dispatch of `Controlled release` from `main`. Its `production` environment carries no protection rule on this plan.
- Actions: permit the controlled-release workflow to write the release commit and version tag.
- No secrets are needed. The Design System repository is public and installs from its GitHub tarball.

Making the repository public or moving to GitHub Pro would allow a `main` protection rule that requires the `Quality gate` checks; that is João's call.

## Updating the Design System (Atualizar o DS)

The Design System is a pinned dependency: `package.json` points `@content-ventures/design-system` at the tarball of one DS commit, and `pnpm-lock.yaml` locks it. CI and clean clones always build against that pin.

Publishing a change (the only path that reaches CI, review and acceptance):

1. Change the Design System in its own repository under its contract: extend the existing primitive, tokens only, `data-*` states with `[data-force]` twins, keyboard, reduced motion, 390 px, a test, a catalog specimen, a README note and a CHANGELOG line. Merge its PR with rebase and tag the version.
2. In Reporter, replace the commit SHA in the `@content-ventures/design-system` URL with the tagged commit and run `pnpm install`.
3. Run `pnpm gate` and `pnpm smoke`, then commit `package.json` and `pnpm-lock.yaml` alone as `build(deps): pin design system vX.Y.Z`.

Previewing an unpublished change locally (temporary, while the DS 0.2.0 used by R1 · Experiência is unpublished):

```sh
DS=/path/to/design-system   # a local checkout of the DS branch
TARGET="$(cd node_modules/@content-ventures/design-system && pwd -P)"
rsync -a --delete "$DS/src/components/" "$TARGET/src/components/"
rsync -a --delete "$DS/src/fonts/" "$TARGET/src/fonts/"
```

- The copy lives only in this machine's `node_modules`; it is never committed and CI never sees it.
- Any `pnpm install` or `pnpm add` restores the pinned package: run the copy again right after. `pnpm install --force` returns to the pin on purpose.
- The copy does not bring the DS `package.json`, so import only from the `@content-ventures/design-system/v3` barrel.
- Retire the copy as soon as the DS version is tagged and pinned; from then on a clean clone must pass `pnpm install --frozen-lockfile && pnpm gate`.

## Acceptance build (Build de aceite)

Acceptance sessions run the production build of an exact commit, never `pnpm dev`: the Next.js development indicator covers the account switch, and development builds are slower and print development-only warnings.

1. On a clean checkout of the commit under acceptance: `pnpm install --frozen-lockfile && pnpm gate`.
2. `pnpm start -p 3001` (the build from step 1).
3. `SMOKE_BASE_URL=http://localhost:3001 pnpm smoke` must pass before anyone else opens it.
4. For a phone, expose the server over HTTPS with a stable hostname. Plain HTTP on the local network is not a secure context, which breaks ids and the clipboard. Installing a tunnel tool and exposing the app each need João's explicit approval; stop the tunnel when the session ends.
5. Follow the acceptance script in the README ("Roteiro de aceite"), starting at `/?reset=1`. Data stays in each browser, so every device starts from the fixtures.
