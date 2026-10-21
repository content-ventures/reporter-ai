# Neon worker release and verification

An application build does not deploy the Neon worker. The controlled release deploys the
migrations, bucket CORS, function and triggers on staging, accepts them there, then repeats the
deployment on production before handing the release commit to Vercel. The app wakes the worker on
demand through `REPORTER_WORKER_URL`; an hourly schedule only catches a lost wake-up. Setup,
stages and rollback are in [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md).

## Large recordings

Groq's documented file limits also apply to URL transcription (25 MB free, 100 MB developer).
Sending a whole 406 MB recording by URL cannot replace the local worker's audio chunking.
Cloud recordings now use the same overlapping ten-minute, mono 16 kHz, 16-bit FLAC chunks as local
recordings, each under 24 MB. Only these audio chunks are sent to Groq. Conversion reads the
private original through a per-job loopback byte-range bridge; Node verifies upstream HTTPS
and handles DNS, and the original is never buffered in full or saved to the function's disk.
Each completed chunk is stored in PostgreSQL under the job's lease, so a retry or a new invocation
resumes where the last one stopped; a job near its time budget yields without spending an attempt.

Neon Functions run Linux ARM64 and cap compressed bundles at 10 MiB. CI cross-compiles a
minimal shared-library FFmpeg 9.0.2 build from the official release, verifying its signature
against the pinned FFmpeg release key. The tools, required libraries, version and LGPL license
are included in the immutable function package; the archive gate enforces both Neon size limits.
The hosted runtime mounts every writable location with `noexec` and delivers package files as
0644. The system ARM64 ELF loader reads the bundled tools and their bundled libraries directly
from the executable, read-only package mount. No runtime download, writable executable staging
or mount-policy change is required. Local workers continue using their configured/system tools.
Readiness executes both binaries, verifies the upload CORS and reaches PostgreSQL; nothing is
registered. After a deployment the release lists the branch's live triggers, refusing any
undeclared one or any schedule faster than hourly, and asks the worker for one complete drain
pass, recording its receipt. A failure stops the release before the Vercel release commit is pushed.

Schedule and storage deliveries use `/triggers/schedule` and `/triggers/storage`; a schedule
delivery starts at most one sweep per isolate every five minutes, and a forged one reads nothing.
The handler passes headers and JSON directly to the Neon SDK, without assuming
the hosted request shares Node's global `Request` constructor or clone behavior.
Both routes retain the SDK's invocation-header/body validation. Rejected deliveries
emit a bounded reason code to the function console for release diagnostics.

Readiness executes both media tools and returns bounded launch error codes. Authenticated
failure diagnostics include the package version, fixed tool sizes/modes, platform and loader
availability, without provider URLs, credentials or user material.
`validation_only` deploys and accepts on staging without touching production, from any branch.

## GitHub environments

The `staging` and `production` environments, their variables and secrets are listed in
[RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md). The worker password must match the existing
`reporter_worker` role; roles are never rotated by a release. Provider credential checks run before
any infrastructure change and authenticate with metadata or search endpoints; they do not prove
quota for every generation model.

Gemini is optional. When `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is present in the selected GitHub
environment, the workflow passes it to the Neon worker and staging acceptance as `GEMINI_API_KEY`.
Its preflight reads [Gemini model metadata](https://ai.google.dev/api/models) with the key in a
request header; it generates no content and does not establish model-specific access or quota.
Existing deployments without this key keep their current provider requirements.

## Verification

Acceptance runs on the persistent staging project, never on production and without creating a
branch. The core path generates synthetic speech offline with espeak-ng, uploads 20 seconds through
multipart storage and the storage trigger, checks real Groq transcription, then generates one
article from the fixture interview through staging's saved pipeline and has a separate review-only
member approve it. `REPORTER_ACCEPTANCE_SCOPE=full` adds an uploaded image read by the reviewer,
the carousel and its approval, the browser export (Markdown, HTML, images, slide PNGs, JSON and
manifest) and pasted-text and UTF-8 file ingestion.

For an original large recording, write a staging environment with `node scripts/staging-env.mjs
<file>`, start the candidate production build on loopback with it, and run
`scripts/neon-browser-acceptance.mjs` with `REPORTER_ACCEPTANCE_MEDIA_PATH`. The script creates
verified synthetic accounts on staging and signs in through the real app. A test-browser reverse
proxy serves the candidate build under the first staging origin so browser CORS matches the
staging bucket. Screenshots and a result manifest are saved under the local temporary directory,
or under `REPORTER_ACCEPTANCE_EVIDENCE_DIR`. Afterwards `REPORTER_ACCEPTANCE_TRANSCRIPT_ID` lets the
editorial acceptance reuse that exact transcript, checking the completed private source and, when
supplied, its exact `REPORTER_ACCEPTANCE_MEDIA_BYTES`.

Cloud images live under private `images/<portal>/<hash>` Object Storage keys. The Next.js server
authorizes access and obtains short-lived URLs through the authenticated worker gateway; browser
uploads go directly to storage and are decoded/hash-checked before their metadata is committed.
Image reads stream through the authenticated same-origin app route, including exports, so private
image retrieval does not require widening the bucket's browser CORS policy.
Sequential writing separates each part's target from the whole article's limits and carries
unused character space forward without increasing the total ceiling. Each part also receives its
share of the article's minimum characters and words. A part below its share is developed once
through the saved template, and whatever it still misses raises the next part's minimums and
budget. A failed part receives at most two measured revisions; a revision that breaks the hard
contract never replaces a valid draft, invalid answers are never cached or published and
sentences are never clipped. Quote validation accepts adjacent cited ranges only
inside the same immutable source segment, rejects gaps and source/version changes, and restores
source capitalization only when the quoted words and punctuation already match exactly.
Workspace polling reads an authorized change stamp (`reporter_ed_status`) without selecting any
editorial row. Unchanged responses contain only that stamp; a browser that knows a recent change
number receives only the rows stamped after it, and a full snapshot otherwise. Idle browsers poll
every 15 seconds and active generations every second; a hidden tab stops polling. Membership and
session identity changes invalidate the stamp even when no editorial command advances it. Worker
previews are published at most every 1.5 seconds, and each progress write reads only its own run.
Fresh sessions also receive the durable image inventory needed for review and export. Idle worker
invocations run one boolean pending check, honoring delayed retries and active leases; a drain
claims runs in SQL with `SKIP LOCKED`, and fenced leases decide which worker may commit a result.
Spotify enclosure imports use durable, leased storage registrations drained by the worker, so
neither media nor image persistence depends on the Vercel filesystem or another browser's IndexedDB.

- `pnpm gate`: policies, lint, types, application tests and production compilation.
- `pnpm test:backend`: cloud chunking, cache reuse, failure cleanup, immutable package launching, HTTPS
  range forwarding/cleanup and failed readiness, plus the existing backend contracts.
- `node scripts/check-neon-bundle.mjs`: builds the real worker with staged Linux ARM64 native
  packages and enforces Neon's compressed/uncompressed archive limits. CI runs this independently
  of the Next.js build.
- `bash scripts/build-native-media.sh`: builds the minimal ARM64 tools from signed FFmpeg sources
  in a Debian bookworm build environment. CI uses the shared build action and caches only the
  public compiled package. Cross-compilation uses `REPORTER_NATIVE_CROSS=true`.
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
