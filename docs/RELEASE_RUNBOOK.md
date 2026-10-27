# Release runbook

How Reporter IA reaches production, how to set it up once, and how to undo a release. The
`Controlled production deployment` workflow runs these stages in order and stops at the first
failure:

1. **Verify**: the complete quality gate (unit, backend, PostgreSQL, cloud rehearsal, smoke).
2. **Staging worker**: migrations, worker, upload CORS, readiness, triggers and a drain receipt on
   the staging project.
3. **Acceptance**: the default workspace scope uses prepared content, independent clients, separate
   approvals and actual downloads without AI calls. Explicit `core`/`full` scopes use paid providers.
4. **Production worker**: the same deployment on production. This stage runs only from `main` and
   is skipped with `validation_only`.
5. **Release**: version, changelog and history in one `chore(release): vX.Y.Z` commit and tag,
   pushed to `main`. The Vercel Git integration builds it.
6. **Verify production**: waits until the production app serves that version and commit, has every
   setting, and wakes the worker just deployed.

Every worker deployment first refuses destructive migrations and stops when the period's Neon
transfer passes 60% of the quota.

## One-time setup

### Production Neon project

- Restore the compute by upgrading the plan, or wait for the next billing cycle.
- Protect the production branch. Acceptance refuses protected branches.
- Note its project and branch IDs for the GitHub `production` environment.

### Staging Neon branch

Staging is a persistent `staging` branch of the production project, created from the protected
production branch. Buckets, functions, triggers and Auth are per branch in Neon, so staging never
touches production's storage or worker. Every staging deployment first migrates a copy of
production's data, which rehearses the production migration. Neon gives the roles of a branch
created from a protected one new passwords, so set them again. Do not protect the staging branch.
Then, from any folder, set both owner variables to the staging owner URL:

```sh
export DATABASE_URL_UNPOOLED='<staging owner URL>' DATABASE_URL='<staging owner URL>'
pnpm db:cloud:migrate
pnpm db:cloud:roles -- --rotate --write /private/tmp/reporter-staging-roles.env
pnpm db:cloud:grant -- --email you@example.com --role admin
```

Each command first prints `Target database: …`; stop if it is not the staging host. Copy the two
passwords from the written file into the staging secrets, then delete the file.

### GitHub environments

| Environment | Variables | Secrets |
| --- | --- | --- |
| `staging` | `NEON_PROJECT_ID`, `NEON_BRANCH_ID`, `REPORTER_APP_ORIGINS`, `REPORTER_ACCEPTANCE_TARGET=staging`, optional `NEON_TRANSFER_QUOTA_BYTES` | `NEON_API_KEY`, `REPORTER_WORKER_PASSWORD`, `REPORTER_RUNTIME_PASSWORD`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PIXABAY_API_KEY`, optional `TAVILY_API_KEY` and `GEMINI_API_KEY` (alias `GOOGLE_API_KEY`) |
| `production` | `NEON_PROJECT_ID`, `NEON_BRANCH_ID`, `REPORTER_APP_ORIGINS`, `REPORTER_APP_URL`, `NEON_TRANSFER_QUOTA_BYTES` | `NEON_API_KEY`, `REPORTER_WORKER_PASSWORD`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PIXABAY_API_KEY`, optional `TAVILY_API_KEY` and `GEMINI_API_KEY` (alias `GOOGLE_API_KEY`) |

- `REPORTER_APP_ORIGINS` lists the exact browser origins allowed to upload, comma-separated, such
  as the production domain. On staging, use the stable Vercel preview origin of the branch you test.
- `REPORTER_APP_URL` is the production base URL that the final check polls.
- `NEON_TRANSFER_QUOTA_BYTES` is the plan's included monthly transfer in bytes. Without it, the
  check assumes the Free plan's 5 GB; `0` disables it.
- `REPORTER_ACCEPTANCE_TARGET=staging` exists only on `staging`. Acceptance refuses to run without it.

### Vercel

Settings stay in the Francal workspace dashboard; never use the Vercel CLI or a local token.

| Setting | Production | Preview |
| --- | --- | --- |
| `REPORTER_DEPLOYMENT_MODE` | `cloud` | `cloud` |
| `REPORTER_DATABASE_URL` | runtime role URL | staging runtime role URL |
| `REPORTER_WORKER_URL` | production worker URL | staging worker URL |
| `REPORTER_WORKER_PASSWORD` | production worker password | staging worker password |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | production Auth | staging Auth |
| `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PIXABAY_API_KEY`, optional `TAVILY_API_KEY` and `GEMINI_API_KEY` (alias `GOOGLE_API_KEY`) | provider keys | provider keys |
| `RSS_APP_API_KEY`, `RSS_APP_API_SECRET` (optional) | RSS.app account | RSS.app account |

The worker URL appears as `NEON_FUNCTION_REPORTERWORKER_BASE_URL` in `neon env pull` once the
worker has been deployed. `pnpm cloud:check -- --url <app>` reads a deployment's public
`/api/reporter/health` and names any missing setting; it never shows a value.

### Production domains

The app checks same-origin requests itself, and its canonical URL falls back to the Vercel
project's production domain, so Vercel needs no origin setting. Two places list every production
origin, such as `https://reporteria.contentventures.com.br` and `https://reporter-ai-three.vercel.app`:

- **Neon Auth domains** of the production branch. A missing origin fails sign-in with
  `INVALID_ORIGIN`. A change applies at once.
- **`REPORTER_APP_ORIGINS`** on the GitHub `production` environment, comma-separated. The worker
  accepts upload requests only from these origins, and the bucket CORS is written from them. A
  change applies at the next production worker deployment: a release, or `Deploy the Neon worker`
  with the current tag.

## Releasing

- **Roadmap release.** After Rn acceptance, merge the exact commit
  `chore(release): declare Rn roadmap release` with its actual release number, such as R1 or R2.
  Its reviewed scope and English release notes are stored in `release-history.json` while that
  release is upcoming. The controlled workflow then generates `vn.0.0`; do not edit version files
  or tag the release by hand. Work on the next roadmap release may already be present on `main`,
  but the release declaration must not describe it as completed.
- **Validate first.** From the branch under review, dispatch the workflow with `validation_only`.
  It deploys and accepts on staging only. The default `acceptance_scope=workspaces` preserves the pilot and checks two synthetic clients, invitations, independent policy/branding, separate approvals and actual browser downloads without AI calls. It refuses a protected or mismatched database, archives its QA workspaces, restores the prior navigation mode and revokes its temporary staging operator. Login is simulated only at the verified-session boundary; this does not replace real-account operational acceptance.
  The explicit `core` and `full` scopes retain the previous transcription/generation acceptance and incur provider usage, including background images; use them only with the corresponding spending authorization.
- **Release.** After the pull request is merged, dispatch the workflow from `main`.
- **Read the run.** Its summary records the transfer reading, each drain receipt and the live version.

During the minutes between the production migration and Vercel serving the new app, the old app
keeps reading; migrations are additive. The first release after the editorial-rows migration is
the exception: the previous app can no longer save editorial changes until the new app is live.

## When a stage fails

| Stage | Meaning | What to do |
| --- | --- | --- |
| Verify | The source does not pass its own gate | Fix on a branch; nothing was deployed |
| Staging worker or acceptance | The candidate fails on real infrastructure | Production is untouched; read the step log |
| Production worker | Production's migrations, settings or quota | The app still runs the previous release |
| Verify production | Vercel did not serve the release, or a setting is missing | Check the Vercel build; `pnpm cloud:check` names the setting |

## Rolling back

- **App**: use Vercel's Instant Rollback to the previous production deployment.
- **Worker**: dispatch `Deploy the Neon worker` with the environment and a released tag. It refuses
  any source that schedules the worker more often than hourly. Releases from before on-demand
  draining can never be redeployed.
- **Editorial rows**: if the app must return to a release from before migration 016, stop the
  worker, then run `database/rollback/editorial-rows.sql` with psql as the database owner. It
  writes the rows back into the editorial document; replaying 016 later imports them again.
- **Data**: Neon point-in-time restore to a new branch is the last resort. It never replaces the
  production branch without a decision.
