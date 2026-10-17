# Export and article-image performance

These changes keep the configured providers, models, prompts, image resolution and editorial
validation contracts. They remove duplicate work and move optional images after text completion.

## Export preparation

The delivery screen retains the results of its current preparation. It passes those results to
manifest finalization instead of asking the adapter to render the slides again. Four slides
therefore require four successful renders, rather than eight. Image bytes and SHA-256 calculation
remain unchanged. Every call still validates the exact approved versions and current metadata.

A failed file stays excluded from the manifest until explicitly retried. A retry rebuilds only
that file and refreshes the manifest. Manifest attempts are ordered so an older asynchronous
result cannot replace a newer retry. Results live only with the current screen preparation;
there is no application-wide cache of generated PNG data URLs.

## Background article images

The text worker commits the fully validated article and its optional image task atomically.
The parent run is completed immediately, so editing, versioning and review are available.
Image planning and generation use the immutable pipeline snapshot in that completed run's job.
Images run after claimable transcription and text jobs in both local and hosted workers.

Migration `019-background-article-images.sql` adds image claiming and renewal to the existing
editorial job rows. Image attempts are independent of text attempts. Claims use expiring leases,
`SKIP LOCKED` and a fresh fence; a replaced worker cannot attach a late result. Existing worker
wake-ups and recovery sweeps discover pending image tasks. Image failures never fail the text run.
When an invocation exhausts its budget, the scheduler releases its active promise before calling
the continuation. A continuation routed to the same isolate starts a fresh drain; finishing the
old invocation cannot clear the new one. A regression test reproduces this concurrency case.

Before provider calls and before attachment, the worker checks source authorization and context,
the draft's full body, revision and base version, active generation, review and decisions.
The full-body check includes review flags and manual image choices. A matching result becomes a
new immutable version with unchanged prose; the original text version remains intact. If the
draft changes while images are generated, their assets remain available in that production but
the worker preserves the current draft. Changed or unauthorized source context prevents attachment.
The normal workspace polling brings completed images to open browsers.

## Validation and rollout

Export regression tests count render calls and verify failed-file manifest entries and retries.
The PostgreSQL rehearsal runs the real text worker and scoped transactions with synthetic
providers, checking completion before images, editing during generation, lease reclamation,
stale-worker rejection and optional provider failure. No paid provider is required by these tests.
The controlled staging acceptance also waits for the deployed background task, verifies unchanged
article prose and decodes its stored image through a fresh reviewer before approving the article.

Apply migration 019 through the normal migration registry before running the updated worker.
Versioning and publication follow the controlled release workflow. A timed local rehearsal with
real recordings, live providers and simultaneous editor identities is documented in
[the Seafood Show load report](SEAFOOD_LOAD_REPORT.md). Hosted end-to-end latency and the
production capacity ceiling still need verification; local results are not a production SLA.
