# Multi-workspace operations

This runbook describes the implemented application flows. Production activation remains subject to the controlled release and the acceptance evidence in [the execution ledger](MULTI_WORKSPACE_EXECUTION.md). Local validation does not mean the production application has been upgraded.

## Client identity and coverage

A workspace represents a client. Create productions for that client's different fairs, interviews and coverage periods inside the same workspace. Coverage information belongs to the production brief; it does not create another workspace or another navigation level.

The existing Seafood operation is adopted in place: workspace `10000000-0000-0000-0000-000000000101`, slug `reporter-ai`. Its current display name is Reporter IA. Existing links, members, production IDs, sources, approvals, policy history and historical templates retain their identity. A display-name change is an explicit administrative operation.

## Onboard a client

1. As the platform administrator, open `/platform/workspaces` and choose **Criar workspace**. Set the client's name and address. The address is an identifier; use one per client.
2. Open the created client's setup. Configure its editorial map and writing guide, then **Modelos e marca**. Choose its publication name, supported compositions, default composition, typeface and authorized logo.
3. In **Equipe**, choose **Convidar pessoa**. Select the client's editor and approver roles. An existing account joins with the same identity and password. A person may have different roles in other clients.
4. Copy and distribute the invitation link through the approved channel. Creating an invitation does not send an email automatically. The recipient signs in with the invited account and accepts it.
5. Check readiness: **Mapa editorial**, **Guia de escrita**, **Modelos e marca**, **Editor ativo** and **Aprovador ativo**. Activate only after the required setup is complete.
6. Configure any supported integration and processing limit for that client. Keep a generated integration credential private; a credential selects its authorized destination on the server.
7. Enter the client through **Trocar workspace** or `/workspaces`. Complete a synthetic production through generation, review by another account, approval, carousel review and actual downloaded delivery before handing over real client work.

No client onboarding step requires a code change, deployment or manual database operation. The supported composition presets are configurable; designing a new visual composition is a separate template-design task.

## Access and team changes

The account identifies the person; each workspace membership grants its roles and status. Suspending a membership affects that client. Suspending the global account affects all its memberships. A client administrator manages only that client's team and configuration and cannot grant platform administration.

Use the global people directory to inspect a person's memberships. Use the selected client's team for a client-specific change. Reload a stale form after a conflict before applying a new revision. Self-lockout protection and the editorial approval rules remain enforced on the server.

An account with no authorized membership sees its access state and cannot enter another client by guessing its address. The last visited workspace is only a navigation preference. An unavailable explicit address always requires a manual choice; it does not open Seafood as a substitute.

## Navigation and pending work

Use **Trocar workspace** in the sidebar. Its links preserve the client when copied, reloaded or opened in another tab. The signed-in account remains visible independently of the selected client.

Let an upload or save finish before changing clients. The runtime waits for pending writes in their original context. An unconfirmed write retains a visible failure and requires retry or an explicit decision to leave. Another successful image cannot hide a failed image. Closing or reloading the document while writes are pending warns before discarding the screen.

Jobs already queued continue with their recorded workspace, actor, configuration and input versions. Changing the visible client never changes a job's owner. Leaving the delivery screen stops its remaining browser downloads and ignores late completion notifications.

## Editorial configuration and exports

A map or guide edit applies to future generation under its new immutable revision. Article and carousel writing receive the selected workspace's captured policy. Quotes, evidence, exact approval and output contracts remain platform rules.

Template and brand changes create a revision used for future production. Existing approved versions retain the configuration and template identity recorded with them. Configuration copying requires a reviewed selection and does not copy content, people, approvals or integration credentials.

Download the approved package and check the actual article, image bytes, carousel PNGs and manifest. The manifest records workspace ownership, approved versions and people, generation configuration, image credit/rights and hashes. A prepared image file contains the same bytes that its manifest hashes.

## Inspect a member

As the platform administrator, open a person in the global directory, select the intended active membership and choose **Visualizar como usuário**. The resulting context lasts up to five minutes and is bound to the current login session and exact membership revision.

The shell shows the real operator, the viewed person and client, and **Somente leitura**. Use the persistent exit action to return to the operator's account. Copying a link does not authorize another person or login session. Expiry, membership changes and loss of authority end the context. The server refuses writes, approvals, generation, invitations and uploads even if a request is sent outside the UI.

## Archive and restore

Archive through the client's setup. New operations stop immediately; recorded work settles before final archive. History remains retained. Restore through the same authorized administrative flow and recheck membership, configuration and readiness before resuming production. Archiving a client does not delete the global accounts used elsewhere.

## Activation and incidents

Open **Navegação** in `/platform/workspaces`. **Disponibilidade da navegação** offers:

| Setting | Effective behavior |
| --- | --- |
| **Administração da plataforma** | Only actual platform administrators use addressed workspace navigation. Authorized existing pilot users retain their legacy entry. |
| **Equipes dos clientes** | Active members can choose their authorized workspaces. |
| **Pausada** | New addressed contexts are refused. The authorized legacy pilot entry remains available. |

A fresh activation record starts in the administration setting. A server environment ceiling can restrict availability further; the drawer shows the effective result. Availability never grants a membership or a role. Changes are revision-checked and audited with the real operator and before/after setting. Migration replay preserves the saved setting.

For an isolation failure, stop further activation and pause the affected operation. Retain job, migration and audit receipts. Let owned work settle under the established lifecycle. Keep app and worker source revisions compatible with the retained database. The worker's protected readiness probe must report the exact checked-out source revision, in addition to successful database, storage and media checks.

Recover using the last compatible app/worker revision or a forward fix. Keep additive workspace data and historical configuration. Do not restore a pre-workspace database over new client writes as a routine rollback. Follow [the release runbook](RELEASE_RUNBOOK.md) and the [Neon deployment instructions](NEON_RELEASE.md).
