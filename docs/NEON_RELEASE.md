# Neon worker release and verification

An application build does not deploy the Neon worker. Cloud upload registration requires a
recent worker endpoint in PostgreSQL; without it, `/api/reporter/uploads` returns 503 before
uploading any bytes. The controlled release now deploys the database migrations, bucket,
function and schedule/storage triggers before handing the release commit to Vercel.

## Large recordings

Groq's documented file limits also apply to URL transcription (25 MB free, 100 MB developer).
Sending a whole 406 MB recording by URL cannot replace the local worker's audio chunking.
Cloud recordings now use the same overlapping ten-minute, mono 16 kHz FLAC chunks as local
recordings, each under 24 MB. Only these audio chunks are sent to Groq. Conversion reads the
private original through a per-job loopback byte-range bridge; Node verifies upstream HTTPS
and handles DNS, and the original is never buffered in full or saved to the function's disk.
Failed chunks are removed and validated completed chunks can be reused by a retry.

Neon Functions run Linux ARM64 and cap compressed bundles at 10 MiB. The two pinned media
executables live under content-addressed `worker-tools/` keys in the private source bucket,
outside the `incoming/` storage-trigger prefix. Release provisioning verifies archive SHA512,
binary SHA256 and ELF architecture. Each function isolate downloads and verifies the tools
once, sets private executable permissions in `/run`, and shares concurrent installation calls.
The health endpoint executes both binaries, verifies the existing upload CORS, then registers its database
heartbeat. The release then waits for a fresh real scheduled invocation, excluding health and
diagnostic calls, so a missing/broken schedule cannot pass and fail again three minutes later.
A failure stops the release before the Vercel release commit is pushed.
The worker registers its configured public HTTPS invocation origin, rather than the internal
HTTP request URL supplied by the hosting runtime.

Schedule and storage deliveries use `/triggers/schedule` and `/triggers/storage`.
The handler passes headers and JSON directly to the Neon SDK, without assuming
the hosted request shares Node's global `Request` constructor or clone behavior.
Both routes retain the SDK's invocation-header/body validation. Rejected deliveries
emit a bounded reason code to the function console for release diagnostics.

Media downloads consume the S3 async-stream contract and retain exact size/hash
verification. Readiness distinguishes object-storage access, missing objects,
stream format, integrity, local filesystem and executable-launch failures with
bounded error codes; release logs print those codes without provider details.
Standalone executables install in `/run` in Neon Functions. `/tmp` remains for media data
and caches because it is mounted `noexec`; changing file permissions there cannot enable execution.
The `validation_only` workflow can prepare an expiring real-file acceptance session with
`prepare_session`. Only its isolated branch is retained, with a 24-hour expiry, for testing the
original large file through the candidate app. Production releases always run the automated
acceptance and never use this retention option.

## Required GitHub production environment

Variables: `NEON_PROJECT_ID`, `NEON_BRANCH_ID` (the intended production branch ID).
Secrets: `NEON_API_KEY`, `REPORTER_WORKER_PASSWORD`, `GROQ_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `PIXABAY_API_KEY`. The OpenAI/Anthropic aliases `OPEN_AI_API_KEY` and
`CLAUDE_API_KEY` are accepted. The worker password must match the existing `reporter_worker`
database role. Never rotate or reset roles as a release side effect.

Provider credential checks run before any infrastructure mutation. They authenticate using
provider API metadata/search endpoints; they do not claim quota or access for every generation
model. Worker health verifies database access, storage and media execution. Candidate acceptance
runs against an isolated Neon branch before any production release.

## Verification

Production releases first run the complete acceptance on a workflow-created, expiring Neon child
branch. Inherited triggers remain disabled until the candidate worker is deployed with the child
database connection. The workflow provisions media tools, requires a fresh scheduled invocation,
uploads synthetic speech through multipart storage, checks real Groq transcription, generates an
article and carousel through the saved production pipeline (or its default seed), approves both with a separate review-only member, reads an
uploaded image as that reviewer and builds the browser export (Markdown, HTML, images, slide PNGs,
JSON and manifest). The child branch is removed on completion. A failed acceptance stops before
production migrations or deployment. `validation_only` runs the same acceptance without publishing.
The article uses that uploaded source's actual transcript. The same acceptance also exercises
pasted text and UTF-8 file ingestion through real material analysis and article generation.

For an original large recording, prepare a session, then use `scripts/open-neon-acceptance.mjs`
with its branch ID and the authenticated Neon environment. It writes a mode-0600 temporary
environment file. Start the candidate production build on loopback with that environment and
run `scripts/neon-browser-acceptance.mjs` with `REPORTER_ACCEPTANCE_MEDIA_PATH`. The script
creates verified synthetic accounts on the isolated branch and signs in through the real app.
A test-browser reverse proxy serves the candidate build under the app origin so browser CORS
matches production; every app-origin request is intercepted before it reaches production.
Screenshots and a result manifest are saved under the local temporary directory.

Cloud images live under private `images/<portal>/<hash>` Object Storage keys. The Next.js server
authorizes access and obtains short-lived URLs through the authenticated worker gateway; browser
uploads go directly to storage and are decoded/hash-checked before their metadata is committed.
Image reads stream through the authenticated same-origin app route, including exports, so private
image retrieval does not require widening the bucket's browser CORS policy.
Spotify enclosure imports use durable, leased storage registrations drained by the worker, so
neither media nor image persistence depends on the Vercel filesystem or another browser's IndexedDB.

- `pnpm gate`: policies, lint, types, application tests and production compilation.
- `pnpm test:backend`: cloud chunking, cache reuse, failure cleanup, binary integrity, HTTPS
  range forwarding/cleanup and failed readiness, plus the existing backend contracts.
- `node scripts/check-neon-bundle.mjs`: builds the real worker with staged Linux ARM64 native
  packages and enforces Neon's compressed/uncompressed archive limits. CI runs this independently
  of the Next.js build.
- `node scripts/provision-worker-media.mjs --check`: downloads and verifies the pinned tool
  distributions without uploading anything. CI runs this too.
- `node --input-type=module -e 'import {verifyFreshBootstrap} from "./scripts/reporter-db-integration.mjs"; await verifyFreshBootstrap();'`:
  disposable official PostgreSQL bootstrap, migration replay, concurrency and private multipart
  intake tests. Does not reuse or modify the existing local Docker database.

On 2026-10-15, local acceptance authenticated to Groq, OpenAI, Anthropic and Pixabay, and connected
with both configured Neon database roles. A disposable Node 24 Linux ARM64 container converted
and transcribed a synthetic Portuguese MP4 of 425,721,856 bytes (406 MiB), reading 6,946,816 source
bytes through HTTPS ranges and returning 164 transcript characters from Groq `whisper-large-v3`.
The file contained short synthesized speech and sparse padding; this verifies the large-file
range/conversion path, not an hour-long recording or production load. No user recording, deployed
worker, live application, Vercel variables or production data was modified for that acceptance.

References: [Groq speech-to-text limits](https://console.groq.com/docs/speech-to-text),
[Neon function deployment](https://neon.com/docs/compute/functions/deploy),
[Neon runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits).
