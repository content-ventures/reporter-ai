# Platform console

`/platform` is the platform operator's console: people across every workspace, access links, roles, suspension, the sign-ups waiting for release, and usage. It is not part of the workspace menu and never loads the editorial runtime.

## Who opens it

Only a person who holds the platform role (`public.user_roles.role = 'platform_admin'`). Anyone else gets a 404 from the layout (`platformAccess`), and every SQL function checks the role again (`core.platform_operator()`, with `app.access_mode='platform'`). A workspace `admin` is not a platform operator.

The role is granted only from the terminal, never from a screen:

```sh
pnpm db:cloud:grant --email operator@example.com --role admin --platform-admin
```

`grant` also resets the person's workspace roles to `--role`. Locally, migration 020 grants it to the synthetic development operator.

## Access links

"Novo acesso" takes a name, an e-mail and a role. The answer is a link (`/auth/invite/<token>`, valid for 7 days). Nothing is e-mailed: the operator sends the link however they want.

- The token is 32 random bytes; the database keeps only its SHA-256 (`core.access_invites`). A new link revokes the previous one, and suspending someone revokes an open link.
- The page shows who the link is for, then asks for the password. The server creates the Neon Auth account (`/sign-up/email`), or checks the existing account's password (`/sign-in/email`) when the e-mail already has one.
- `public.reporter_invite_accept` then binds the account to the person, marks the e-mail verified in `neon_auth.user` and closes the link. The browser signs in with the same e-mail and password and lands on the workspace.
- This relies on Neon Auth sending no verification e-mail on sign-up (`send_verification_email_on_sign_up: false`, the production setting on 2026-10-19). If that changes, the person would also receive Neon's e-mail.

People who signed up on the sign-in page appear as **Aguardando liberação**. "Liberar acesso" binds them with the chosen roles and marks the e-mail verified.

## Statuses

| Status | Meaning |
| --- | --- |
| Ativo | Signed in at least once; membership active |
| Convidado | Has access but never signed in (an open link, or one to generate) |
| Aguardando liberação | A Neon Auth account in no workspace |
| Suspenso | Membership disabled; every request is refused at once |

## Usage

`public.reporter_platform_usage(from)` answers raw facts per UTC day, person, workspace and model; `buildUsageReport` (`src/domain/platform-usage.ts`) builds the totals, the comparison with the previous period, the daily series and the rankings.

- Generations: `reporter_ed_runs` (completed and failed), tokens from the run's folded usage (never summed events, which would count image planning twice), model from `fold.run.model.alias`, author from `fold.run.createdBy`.
- Productions: `doc.createdAt` and `doc.createdBy`. Approvals: `decision` parts with `decision='approved'`.
- Audio: `reporter.transcript.generated` audit rows (`input_units` in audio milliseconds).
- Active days: Neon Auth sessions, audit rows and the authors above.
- Cost is an estimate from the reference prices in `platform-usage.ts` (`PRICES_AS_OF`). Update the table when a provider changes its prices or a model is added; a model without a price shows "—" and the total says so.

## Log

Every console write is a `public.audit_log` row with `source='platform'` and action `platform.<action>`: who acted, on whom, and the roles after the change. A password defined from a link has no actor.

## Tests

- `src/ports/contracts/platform.contract.ts`: the console contract, run against the demo adapter.
- `tests/rehearsal/platform.test.ts`: migration 020 and the route handlers on a disposable PostgreSQL with a stand-in Neon Auth.
- `e2e/routes.spec.ts`: the console pages and an invalid link in the fixture build, at 1440 and 390 px.
