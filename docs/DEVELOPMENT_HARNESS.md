# Reporter IA development harness

This document defines the mandatory workflow for human and AI-assisted development. All repository-facing names and messages are written in English. Product copy may remain in Brazilian Portuguese.

## Branches

- Work on a branch; direct pushes to `main` are blocked locally and must also be blocked with a GitHub branch-protection rule.
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
- Configure GitHub to allow squash merges only, using the validated PR title as the resulting commit subject.

## Design System

- Build all visual UI from public exports of `@content-ventures/design-system/v3` and `@content-ventures/design-system/v3/icons`.
- Search the Design System before composing a product-specific component.
- Do not create local visual primitives, tokens, fonts, icons, themes, color values, or substitute UI-library components.
- Product components may compose public Design System components without recreating their visual behavior.
- Local CSS is rejected by default. A future exception requires explicit technical review and must use only public Design System tokens.

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

## Quality gates

The hooks are installed by `pnpm install` and can be restored with `pnpm harness:setup`.

- `commit-msg` validates commit structure and English phrasing.
- `pre-commit` validates commit size and Design System boundaries.
- `pre-push` blocks direct `main` pushes, validates the branch, and runs the complete gate.
- `pnpm gate:quick` runs Design System, content-density and version policies, lint, types, and tests.
- `pnpm gate` adds a production build and is the required release and CI gate.

The gate is intentionally compact. It must stay fast enough for every push while covering repository policy, static correctness, automated tests, and production compilation.

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

The `Controlled release` GitHub Action is manual, runs only from `main`, uses the protected `production` environment, and does the following in order:

1. Runs the complete quality gate on the approved source.
2. Calculates the next valid SemVer and generates release descriptions from commits.
3. Runs the complete gate again against the prepared release.
4. Creates one release commit, an annotated version tag, and a GitHub release.
5. Hands the tagged artifact to the future production-deployment step.

The repository currently has no production provider configuration. Production deployment is intentionally disabled until a provider is selected and its step is reviewed. When added, it must run after release preparation and deploy only the version tag created by this workflow.

Repository setup requirements:

- Add a `DESIGN_SYSTEM_SSH_KEY` Actions secret with read access to the private Design System repository.
- Protect `main`, require the `Quality gate` check, and allow only squash merges.
- Protect the `production` environment with the desired human approval rule.
- Permit the controlled-release workflow to write the release commit and version tag.
