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

## Design System

- Build all visual UI from public exports of `@content-ventures/design-system/v3` and `@content-ventures/design-system/v3/icons`.
- Search the Design System before composing a product-specific component.
- Do not create local visual primitives, tokens, fonts, icons, themes, color values, or substitute UI-library components.
- Product components may compose public Design System components without recreating their visual behavior.
- Local CSS is rejected by default. A future exception requires explicit technical review and must use only public Design System tokens.

## Quality gates

The hooks are installed by `pnpm install` and can be restored with `pnpm harness:setup`.

- `commit-msg` validates commit structure and English phrasing.
- `pre-commit` validates commit size and Design System boundaries.
- `pre-push` blocks direct `main` pushes, validates the branch, and runs the complete gate.
- `pnpm gate:quick` runs the policy check, lint, types, and tests.
- `pnpm gate` adds a production build and is the required release and CI gate.

The gate is intentionally compact. It must stay fast enough for every push while covering repository policy, static correctness, automated tests, and production compilation.

## Deployments and releases

- Production deployment is a deliberate release action, never a side effect of every commit or branch push.
- A release may start only from an approved, clean `main` after `pnpm gate` passes.
- The release process updates the version, description, changelog, and public version history together before deployment.
- Configure the production provider to deploy only version tags created by the controlled release workflow. Preview deployments should be disabled unless explicitly requested for a review.
- Do not open an automatic release PR for each change. Unreleased commits remain grouped until the delivery is ready.

The release automation and SemVer mapping are documented with the version-history implementation.
