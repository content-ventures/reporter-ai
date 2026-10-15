# Reporter IA development harness

This document defines the mandatory workflow for human and AI-assisted development. All repository-facing names and messages are written in English. Product copy may remain in Brazilian Portuguese.

## GitHub identity

- Every commit, push, pull request, merge, Preview and production deployment must be attributable to the authenticated GitHub account performing the action.
- Local commits use the GitHub login as `user.name` and the account's numeric noreply address (`<account-id>+<login>@users.noreply.github.com`) as `user.email`. The macOS username, computer hostname and unrelated personal identities are forbidden.
- Pushes target the `content-ventures/reporter-ai` GitHub repository using GitHub authentication. A local computer identity is never deployment provenance.
- Pull requests and merges are created by the authenticated GitHub user after explicit approval. Bots may validate the work but may not impersonate the user.
- Vercel Preview and production deployments originate only from the Francal workspace's GitHub integration. The Vercel CLI, a local Vercel token and the macOS user's Vercel identity are forbidden.
- The hooks validate the configured author and committer before commit and push. CI validates the author and committer of every delivered commit. A mismatched identity blocks the delivery.
- PR commits retain the strict numeric noreply rule for both identities. On a `main` push only, GitHub's rebase may use the merging account's configured email as committer. CI accepts it only after the GitHub API confirms the exact commit metadata, the author's numeric noreply account, the committer's association with the workflow actor, and a merged PR targeting this repository's `main`. Unassociated identities, API errors and ordinary local/PR personal emails still fail. See [GitHub rebase behavior](https://docs.github.com/en/pull-requests/reference/pull-request-merges).

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

- Local inspection, implementation, tests and commits are allowed within the active worktree. Pushing a branch, opening or updating a PR, merging, requesting a Preview, or starting a production deployment requires João's explicit approval for that exact remote action.
- Open one PR when the work session or complete delivery is ready for review.
- Do not open a PR for every edit or intermediate commit.
- Reuse the existing PR for the branch. Do not create a duplicate PR for the same delivery.
- An earlier PR is acceptable only when collaboration, an architectural decision, or an urgent review genuinely requires it.
- Use a Conventional Commit title in English. The PR body must explain the outcome, validation, Design System usage, release impact, and any deployment consideration.
- Merge PRs with rebase only, to keep a linear history of the validated commits. Squash would fail the per-commit size check on the push to `main`, and a merge commit fails the Conventional Commit check.

## Design System

- Build all visual UI from public exports of `@content-ventures/design-system/v3` and `@content-ventures/design-system/v3/icons`.
- Search the Design System before composing a product-specific component.
- Do not create local visual primitives, tokens, fonts, icons, themes, color values, or substitute UI-library components.
- Product components may compose public Design System components without recreating their visual behavior.
- Local CSS is rejected by default. A future exception requires explicit technical review and must use only public Design System tokens.
- Writing studio correction (October 6, 2026): the user requires the Design System contract for every product component. The earlier editor exceptions are revoked: no local CSS Modules or native JSX UI exceptions. Editor actions, fields, source excerpts, suggestions, block lists, reordering, menus and page layout compose public V3 components without custom skins. Tiptap has no node views: the document is styled by the Design System `Prose` component, and serialized user formatting remains document data. Do not introduce decorative colored side borders or per-paragraph frames.
- Editor boundary: Tiptap is logic only (schema, commands, plugins). No node views (`ReactNodeViewRenderer`, `NodeViewWrapper`, `addNodeView`); document styling comes from the DS `Prose` component; in-document markers are attribute-only marks or decorations styled by `Prose` data hooks; previews and actions render outside the document in DS overlays.
- Product code creates no DOM and resolves no CSS: `document.createElement`, `innerHTML`, `dangerouslySetInnerHTML`, `getComputedStyle`, `.style` mutation, `style` props, literal classes and `<style` strings are rejected in `src/`. Any DOM factory belongs to the Design System.
- A page `PageStack` must not contain adjacent open `Section` components. Both own vertical rhythm, causing additive gaps. Compact sidebar groups use `Panel → Section`; related controls use `FieldGroup`, and actions stay within their section.
- Preserve the documented component composition because structural components own spacing. Use `Panel → Section → content`, or a standalone `Section variant="panel"`; never place visual content directly inside `Panel`.
- Removing copy must remove only content props or text. Do not remove a Design System wrapper until its layout role has been checked in the public component contract.

## Architecture

Reporter IA R1 is a full-stack application: Next.js UI and route handlers, durable workers, PostgreSQL on Neon, object storage and server-owned AI providers. Screens remain separated from infrastructure by the typed domain and port interfaces. `pnpm harness:architecture` enforces the layering:

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
- `pre-commit` validates the GitHub author/committer identity, commit size, Design System boundaries, layering and content density.
- `pre-push` validates the GitHub identity, blocks direct `main` pushes, validates the branch, and runs the complete gate.
- `pnpm gate:quick` runs Design System, architecture, content-density and version policies, lint, types, and tests.
- `pnpm test` runs `node --test` on `scripts/**/*.test.mjs` and `src/**/*.test.ts`. Node 24 strips types natively, so tests use erasable TypeScript only (no enums, namespaces or parameter properties; `import type`), which `tsc` enforces with `erasableSyntaxOnly`.
- `pnpm gate` adds a production build and is the required release and CI gate.
- `pnpm smoke` runs the Playwright smoke in `e2e/`: the main path (transcript → speakers → authorisation → generation → edit → send → approval → carousel model → carousel → approval → export package, counting the files that reach the browser), short checks of the model library (`library.spec.ts`: one format at a time and the search, a model opened by its address and made the default, "Trocar modelo" drawing this carousel in the candidate model, kept texts and undo) and of the article (`article.spec.ts`: image slots filled by upload and by a file dropped on them, the review's reading column centred with the side pane open and collapsed, the final article with its images and a vertical one centred), and a sweep of every route at 1440 and 390 px (the phone as a touch device), failing on any console error, page-level sideways scroll, more than one `h1` or a skipped heading level. "Loaded" means no DS `[data-skeleton]` and no busy region. It reuses a server already listening on `localhost:3000` (usually `pnpm dev`); with none, and in CI, it builds and runs `next start` (`SMOKE_PREBUILT=1` skips the build). `SMOKE_BASE_URL` points it at another running build. Install the browser once with `pnpm exec playwright install chromium`.
- CI runs two jobs in the `Quality gate` workflow: `quality` (commit policy and `pnpm gate`, which keeps its production build as an artifact) and `smoke` (after `quality`: `pnpm smoke` on that same build, Chromium cached by lockfile, traces of failed tests kept as an artifact).

The gate is intentionally compact. It must stay fast enough for every push while covering repository policy, static correctness, automated tests, and production compilation. The smoke stays under about a minute on a warm server: add a route to the sweep or a step to the main path, not a new long scenario.

## Deployments and releases

- Production deployment is a deliberate, explicitly approved release action, never a side effect of every commit or branch push.
- A release may start only from an approved, clean `main` after `pnpm gate` passes.
- The release process updates the version, description, changelog, and public version history together before deployment.
- GitHub is the only deployment source. Vercel deployments use the repository's GitHub integration in the Francal workspace. Never deploy with the Vercel CLI, a local Vercel token, or the macOS user's Vercel identity.
- Preview deployments are ephemeral review artifacts, require explicit approval, and never create a product version.
- Every successful production deployment must come from the exact `chore(release): vX.Y.Z` commit created by the controlled deployment workflow. The production build rejects any other commit.
- Do not open an automatic release PR for each change. Unreleased commits remain grouped until the delivery is ready.

The release automation and SemVer mapping are documented with the version-history implementation.

## Semantic versioning

- Reporter IA uses `vX.Y.Z` and is currently in Alpha on the `v0.Y.Z` line. The current baseline is `v0.1.0`.
- `X` is a deliberate commercial release. It changes only for a genuinely new, incompatible product release represented by a breaking Conventional Commit (`type!:`). The first such release moves R0 to R1 and v0 to v1.
- `Y` is an intermediate feature release. Any validated `feat:` commit increments `Y` and resets `Z` to zero.
- `Z` is a correction release. Deployments containing fixes, documentation, refactors, performance work or maintenance without a feature increment `Z`.
- When a delivery contains different commit types, the highest impact wins: commercial (`X`), feature (`Y`), then correction (`Z`). A commercial increment must remain explicit in the commit history; the automation never guesses it from ordinary feature work.
- Every approved production deployment creates exactly one new version. `pnpm release:prepare:auto` calculates the increment from validated commits, writes the English summary and detailed change list, and updates `package.json`, `CHANGELOG.md`, and `src/data/release-history.json` together.

## Controlled release workflow

The `Controlled production deployment` GitHub Action is manually dispatched after explicit approval. With `validation_only` it may run from a reviewed branch and stops after step 2; otherwise it runs only from `main` and does the following in order:

1. Runs the complete quality gate on the approved source.
2. Deploys the worker to the separate staging Neon project and runs the staging acceptance there. A worker deployment refuses destructive migrations and stops when the period's Neon transfer passes 60% of the quota. It then migrates, deploys the `neon.ts` Function with the verified ARM64 media tools, writes the upload CORS and checks readiness. Finally it checks that only the declared triggers are live, none faster than hourly, and records a drain receipt.
3. Repeats that worker deployment on the production branch.
4. Calculates the next valid `vX.Y.Z` from the validated Conventional Commits and generates the release summary, detailed changes, changelog and public version history from those commits.
5. Runs the complete gate again against the prepared release.
6. Creates one `chore(release): vX.Y.Z` commit under the dispatching GitHub user's identity, an annotated version tag and a GitHub Release, and pushes them. The Francal Vercel Git integration performs the production deployment.
7. Waits until production serves that version and commit, with every setting present and the new worker wired.

Setup, failure handling and rollback are in `docs/RELEASE_RUNBOOK.md`.

## Repository setup

The repository is private on GitHub Free. That plan offers no branch protection, required status checks or environment protection rules for private repositories, so the setup is limited to what it allows:

- Pull requests: allow only "Rebase and merge" (squash merging and merge commits off).
- Branch protection: the local `pre-push` hook (installed by `pnpm install`, restorable with `pnpm harness:setup`) blocks direct pushes to `main` and runs `pnpm gate`. The `Quality gate` checks are reviewed on every PR before merging; nothing enforces them on the server.
- Releases: the human approval is the manual dispatch of `Controlled production deployment` from `main`. Its `production` environment carries no protection rule on this plan.
- Actions: permit the controlled-release workflow to write the release commit and version tag.
- Configure the GitHub Actions `staging` and `production` environments with the variables and secrets listed in `docs/RELEASE_RUNBOOK.md`. The existing aliases `OPEN_AI_API_KEY` and `CLAUDE_API_KEY` are also accepted. Before changing infrastructure, the release verifies every required setting and authenticates to the four provider APIs. The release step injects secrets only while applying the Neon config, writes them to a mode-0600 temporary runner file for that step, and deletes that file on exit. Worker readiness must confirm the database connection, upload CORS/storage permissions and actual media-tool execution before the Vercel release is pushed. See `docs/NEON_RELEASE.md` for verification and remaining environment setup.
- Vercel app secrets remain managed in the Francal workspace. Never commit runtime secrets, copy them into release notes, or use a local Vercel identity as a deployment source.

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
