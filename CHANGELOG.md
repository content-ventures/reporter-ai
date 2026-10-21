# Changelog

All notable changes to Reporter IA are documented in this file. Release entries are generated from validated English Conventional Commits.

## [Unreleased]

## [0.16.0] - 2026-10-21

### Added

- Parse a material joined from several recordings.
- Keep each recording of a material sent in parts.
- Create one source from the parts of a material.
- Show where each part of a material starts.
- Send an interview recorded in several files.

### Changed

- Hold the file material as ordered parts.

### Maintenance

- Cover a material sent in two parts.

### Fixed

- Read a .srt part with .vtt cues as it reads alone.
- Sample the opening of every part before the rest.
- Say why a material in parts cannot go on.
- Keep the speakers when a part joins an analysis.
- State the number of parts once.
- Correct a misheard name in every part of a material.

## [0.15.0] - 2026-10-21

### Fixed

- Transcribe again the stretches Whisper garbled.
- Align repairs with the garbled words.
- Keep times and speaker choices when correcting a term.
- Anchor repair edges and refuse speaker-moving fixes.
- Complete cut words and never rewrite the others.
- Keep first-pass tokens and speaker turns intact.
- Keep marks, skip ambiguous pairs and right names.
- Use only pairings every alignment agrees on.
- Complete plain words only and check every word.
- Add accent words between plain words only.
- Check who says every other word when correcting a term.
- Take the term out of the speech before the turn check.
- Recognize a longer right name in any case.

### Added

- Fix a misheard name before creating the production.

## [0.14.0] - 2026-10-20

### Fixed

- Keep the linha fina and tidy event coverage texts.
- Attribute an unlabeled interview to its only speaker.
- Harden quote cleanup, linha fina sync and event offer.

### Added

- Confirm the last event and suggest Completo.

## [0.13.0] - 2026-10-20

### Added

- Keep Drive files on the board until a production uses them.
- Open Drive files in the new production form from the board.
- Accept WhatsApp Opus audio.

### Fixed

- List no Drive files outside the cloud.
- Fail abandoned Drive copies and retry failed transcriptions.

## [0.12.0] - 2026-10-20

### Added

- Give each event format its own worker.
- Tell the workers apart by icon and group.
- Create productions from a Drive folder.

### Fixed

- Lay out the event box as labeled fields.

### Documentation

- Add the Drive folder script and its setup.

## [0.11.0] - 2026-10-20

### Added

- Add event coverage formats to the brief.
- Write event formats through grounded funnels.
- Choose event format, size and event in the pauta.
- Edit the linha fina and size formats by characters.
- Copy event formats with their linha fina and box.

### Fixed

- Tune event funnels from live rehearsals.
- Never fail a format text for being short.

### Maintenance

- Cover event formats in the pauta, smoke and docs.

### Improved

- Store only the funnel prompts someone edited.

## [0.10.0] - 2026-10-20

### Added

- Copy the approved article text to the clipboard.
- Show the speaker's company in the transcript panel.

### Maintenance

- Pin design system v0.4.0.

## [0.9.1] - 2026-10-19

### Fixed

- Keep Seafood V2 chrome clear of block edges.

## [0.9.0] - 2026-10-19

### Added

- Draw rounded boxes, tags, vector marks and brand faces.
- Add Seafood V2 carousel models on the client's brand.
- Write carousel copy for the Instagram feed.

## [0.8.0] - 2026-10-19

### Added

- Model platform access links, roles and usage.
- Add the platform console demo.
- Store access links and the platform role.
- Serve the platform console and access links.
- Add the console frame, overview and usage screens.
- Manage people and access links in the console.

### Documentation

- Describe the platform console and access links.

### Fixed

- Check console access per request, never at build time.
- List the access links table in the SQL catalog.
- List the console log on phones instead of a table.

## [0.7.0] - 2026-10-19

### Fixed

- Give the editorias a heading of their own.
- Keep the Demo badge off the R1 research 404.
- Ask for sign-in on the news, archive and settings routes.
- Say why Cobrir and covered stories wait in the demo.
- Show Criar carrossel only to whoever edits pieces.

### Added

- Keep the Hard News desk read-only in a demonstration.
- Open the Hard News screens in R1 builds as a demo.
- Open Modelos as the shelf gallery in every build.

### Maintenance

- Cover the Hard News demo in the connected smoke.
- Open a model's page in the connected Modelos smoke.
- Check the demo badge on phones and a covered story.

### Changed

- Remove the Codex R2 prototype.
- Remove the image and citation screens no route opens.

### Documentation

- Describe the Hard News demo in R1 builds.
- Correct the Hard News notes after review.

## [0.6.0] - 2026-10-19

### Added

- Add the hard news desk contract.
- Add the news desk preview data.
- Add the image bank rules.
- Add research, library and photo bank preview data.
- Add the desk store and its actions.
- Persist the desk state and share its helpers.
- Gate the R2 preview in the shell and menu.
- Add the news radar board.
- Add the radar rules, story file and dialogs.
- Add the feed sources screen.
- Add the research stage.
- Show sources, evidence and archive links in the studio.
- Send covered stories to the portal CMS.
- Show desk stories on the board and the home.
- Add the image bank screen.
- Add the photo page.
- Add the quote bank screen.
- Add the archive search, shelves and covers.
- Add the archive library screen.
- Edit the editorial map in place.
- Edit the writing guide in place.
- Add the app catalog rules.
- Add the connection guides and the local store.
- Add the app catalog and app pages.
- Add the guided connection and app settings.
- Add the webhooks and WordPress pages.
- Add the model shelves rules.
- Add the model library screen.
- Read the R1 visual library in the image bank.
- Place a photo in the article from the image bank.
- Read the R1 citation library in the quote bank.

### Maintenance

- Cover the image bank rules.

### Documentation

- Describe the R2 hard news preview.
- Describe the R1 wiring of images and quotes.

## [0.5.1] - 2026-10-17

### Improved

- Reuse prepared files when finalizing manifests.
- Complete article text before background images.

### Documentation

- Record real-provider Seafood Show load results.

## [0.5.0] - 2026-10-16

### Maintenance

- Pin design system v0.3.0.
- Enforce breadcrumb-only navigation.
- Follow the board after each stage move.
- Cover the capability pre-check of the command wrapper.
- Read the production trail only on restricted productions.

### Added

- Fill the window with the kanban board.
- Navigate productions by breadcrumbs.
- Name who acts next on a production.
- Approve with a confirmation and open the board.
- Open the board after sending for approval.
- Say the production is complete after the download.
- Mark link import as coming soon.
- Point out the moved production on the board.
- Reduce the photo bank to a search and its photos.
- Add an AI image generator to both runtimes.
- Offer "Gerar com IA" in the picker and on suggestions.
- Deliver generated articles illustrated with AI images.
- Add one capability table to the domain.
- Enforce capabilities in the shared store commands.
- Answer every role refusal with one FORBIDDEN error.
- Report permission limits in one popup instead of red text.
- Hide creation from roles that cannot create.
- Open the article and carousel read-only for reviewers.
- Hide production edits and delivery from reviewers.
- Let the acting member edit their own profile.
- Store each member's self-edited profile.
- Edit name, cargo and photo on Meu perfil.
- Let an admin run the whole flow alone.
- Show the Powered by lockup in the menu.
- Organize the home around greeting, stages and work.

### Fixed

- Keep every level above the current one a trail link.
- Read spread and aliased page headers in the policy.
- Align the recorded navigation rule with the tree.
- Drop the stop actions while the AI writes.
- Spell out the ask action in the text bars.
- Keep the cover suggestion under its actions.
- Keep the title and text bars closed for reviewers.
- Set the menu lockup a little smaller.
- Set the menu lockup smaller still.
- Name the product Reporter IA everywhere.
- Apply the Reporter IA artwork.

### Documentation

- Land the acceptance script on the board after each move.
- Document the role matrix and the permission popup.
- List where production origins are configured.

### Improved

- Read the photo library only when the picker opens.

### Changed

- Send refused actions through notifyRefusal.

## [0.4.0] - 2026-10-16

### Added

- Apply the approved Reporter AI identity and icons.
- Add branded metadata and public indexing rules.

### Fixed

- Improve compact endorsement readability.

## [0.3.0] - 2026-10-15

### Fixed

- Deploy Neon worker during releases.
- Process cloud recordings in bounded audio chunks.
- Validate worker artifacts and service readiness.
- Require a fresh scheduled worker before publishing.
- Keep app worker and smoke on the local database.
- Verify GitHub rebase committer identity.
- Log rejected trigger deliveries.
- Parse native trigger deliveries directly.
- Support hosted media streams and preserve failures.
- Accept runtime streams and expose safe media failures.
- Persist images and authorize independent reviewers.
- Queue remote podcast imports in Neon storage.
- Sign browser uploads without empty payload checksums.
- Validate the full Neon flow before production.
- Verify the saved production pipeline and actual exports.
- Execute media tools and bootstrap Neon acceptance.
- Verify original sources and diagnose hosted readiness.
- Register public endpoints and preserve private image reads.
- Allow native launcher access to verified media tools.
- Revise oversized sections with measured feedback.
- Stage verified tools on executable runtime mounts.
- Bundle signed ARM64 media tools for immutable execution.
- Resolve packaged paths and bound audio sample width.
- Honor shared budgets and contiguous literal evidence.
- Refresh committed writes after pending polls.
- Preserve accessible heading hierarchy.
- Accept seeded database identities in upload tokens.
- Adapt Node UUID generation to engine callbacks.
- Validate the full flow before paid acceptance.
- Diff row writes against a frozen baseline.
- Type the release check's injectable options.
- Name the cloud target and hide its host in public logs.
- Develop short article parts toward the R1 minimums.
- Give the staging env pull its owner connection.
- Wake the staging worker while waiting for its work.
- Bound article parts by the article's remaining room.
- Let a literal quotation adapt its closing punctuation.
- Repair a part the provider will not revise.
- Harden quotation tolerance and the last-resort cut.

### Maintenance

- Exercise authenticated original-file browser acceptance.
- Exclude generated native sources from application lint.
- Install the host compiler for cross-build helpers.
- Record original media and production pipeline evidence.
- Reuse verified originals and synthesize fixtures offline.
- Cover published navigation and account menu flows.
- Pin design system v0.2.1.
- Recognize the updated home screen.
- Run an isolated database per checkout.
- Match workspace mocks by path.
- Add local rehearsal infrastructure.
- Rehearse the cloud flow and idle cost.
- Run the cloud rehearsal.
- Read editorial rows in polling, review and tooling.
- Run the port contracts over HTTP on editorial rows.
- Hold each command to a transfer budget at any size.
- Retire the Vercel CLI env writer and guard role rotation.
- Stage, accept, release and verify production in order.
- Retire the offline preflight built on the single document.
- Move every action to its first Node 24 release.

### Improved

- Bound workspace polling and preview traffic.
- Replace the minute schedule with an hourly sweep.
- Trim per-transaction reads billed as transfer.

### Added

- Organize the editorial dashboard around active work.
- Organize editable prompts by worker flow.
- Unify stages in a scrollable approval kanban.
- Add profile details and browser preferences.
- Add demonstrative editorial settings and source libraries.
- Publish the simulated news research and drafting flow.
- Integrate R2 demonstrations into the shared workspace.
- Report queue stalls and resume transcription chunks.
- Drain on demand with bounded self-chaining.
- Wake the worker after enqueue and heal stalls.
- Resume chunk results from Postgres.
- Add editorial rows, deltas and run claims.
- Split, diff and merge workspace rows.
- Merge editorial row deltas into the workspace.
- Run commands and the worker on scoped row reads.
- Import editorial documents into rows and retire them.
- Compact editorial rows after drains that did work.
- Expose a public health probe and a read-only release check.
- Verify the deployed worker without waiting for heartbeats.
- Accept candidates on a persistent staging project.
- Redeploy a released worker, never an every-minute one.

### Changed

- Replace worker freshness gates with stall status.
- Append run events onto the stored fold.

### Documentation

- Describe editorial rows, the import and the rollback.
- Add the release runbook and retire heartbeat-era notes.
- Run staging as a branch of the production project.

## [0.2.0] - 2026-10-14

### Maintenance

- Add development workflow harness.
- Cover direct creation and reload continuity.

### Added

- Add controlled version history.
- Enforce concise interface copy.
- Connect Reporter AI R1 to Neon (#2).
- Support direct Neon media uploads (#5).
- Show material preparation progress.
- Plan articles before streaming drafts.
- Open the editor directly after pauta.
- Switch test profiles without signing out.
- Show progress before the editor loads.

### Fixed

- Restore design system spacing.
- Install public design system without credentials.
- Generate route types before typecheck.
- Validate change size before squash merge (#3).
- Restore Vercel uploads and retire generic models (#6).
- Unblock material analysis on Vercel.
- Read transcript files without local upload.
- Stabilize streamed article generation.
- Skip non-release production builds.
- Keep mobile profile switching tappable.
- Allow controlled push past local guard.
- Stop repeated analysis after failure.

## [0.1.0] - 2026-10-06

### Added

- Initialized Next.js 16, React 19, TypeScript, App Router, pnpm 10, and the Node.js runtime contract.
- Connected the public Content Ventures Design System V3 API, theme, typography, components, and icons.
- Published the R0 foundation dashboard without introducing R1 editorial features.
