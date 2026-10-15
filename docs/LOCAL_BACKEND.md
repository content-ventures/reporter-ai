# Connected local workflow

The approved R1 interface now uses a same-origin Next.js API, PostgreSQL and a separate AI
worker. No login, Media On connection or ClickHouse is involved. This is a local pilot, not an
Internet-facing deployment or a declaration that every R1 feature is production ready.

## Run

Use `/Users/joaovitor/reporter-ai`, Node.js 24, pnpm 10, Docker Desktop, `ffmpeg` and `ffprobe`.
Both media commands must be on the worker's PATH. Run the app and worker from this project root.

1. Create `.env.reporter-db` from `.env.reporter-db.example`, with three different 24–128-character
   passwords using letters, digits, dots, underscores or hyphens. Never reuse another project.
2. Create `.env.local` from `.env.local.example`, set `GROQ_API_KEY` for transcription and
   `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` for the text models selected in Prompts.
   Existing `OPEN_AI_API_KEY` and `CLAUDE_API_KEY` names are accepted as aliases. Keep `REPORTER_LOCAL_MODE=true`.
   Credentials are server-only; never prefix them with `NEXT_PUBLIC_` or commit them. `pnpm dev:local`
   always forces `REPORTER_DEPLOYMENT_MODE=local`, even if a cloud setting remains in `.env.local`.
   To test the cloud backend from a local browser, run `pnpm dev` with
   `REPORTER_DEPLOYMENT_MODE=cloud` set explicitly.
3. Run `pnpm install`, `pnpm db:up`, then `pnpm db:flow`.
4. Run `pnpm worker:local` in one terminal and `pnpm dev:local` in another. The local worker,
   development app and `pnpm start:local` explicitly select Docker even when cloud credentials coexist.
5. Open `http://127.0.0.1:3002/productions/new`.

For visual acceptance without the Next.js development indicator, stop the app, run `pnpm build`,
then `pnpm start:local`. Keep the worker running. This explicitly allows the local production build
and binds it to loopback, not to the public Internet.

Docker project: `reporter-ai-local`; database: `reporter_ai_local`; port: `127.0.0.1:55432`;
volume: `reporter-ai-local_postgres_data`; network: `reporter-ai-local_reporter`.
A second checkout (another worktree) runs its own isolated database by exporting, for every
`db:*`, app and worker command, `REPORTER_DB_PROJECT=reporter-ai-local-<name>` and a free
`REPORTER_DB_PORT`, with its own `.env.reporter-db`. Helpers refuse a container that belongs
to another checkout, so one checkout never migrates or reads another's data.
Helpers verify the exact container/configuration/volume/network before access. They never globally
prune Docker, delete an existing user volume or touch another project. `db:flow` preserves data.

## Connected behavior

- Read TXT, MD, SRT or VTT in UTF-8 up to 1 MiB directly in the browser, then analyze the material
  through the same API as pasted text. The full text is saved when the production is created;
  these files need no upload route or transcription worker. Invalid UTF-8, empty files and NUL
  characters are rejected. Upload audio/video up to 2 GiB and three hours.
  Supported media: MP3, M4A, MP4, WAV, OGG, FLAC, WEBM. Video must contain audio.
  Pasting text, selecting a file or importing a link opens a responsive progress dialog. It follows
  reading/upload, transcription when required, and metadata analysis. Upload percentages use
  confirmed bytes; processing remains indeterminate. Closing the dialog keeps the task running
  on the same page, and its inline action reopens it. Failed input remains available for retry.
  Multipart filenames are decoded as UTF-8 and normalized to NFC, including decomposed
  macOS accents; the original display name is metadata, never the private storage path.
- The worker converts audio to mono 16 kHz FLAC, splits ten-minute portions with two-second
  overlap, checkpoints successful responses and merges actual timestamps against the original
  recording. It does not fabricate speaker identities or claim diarization. Text is imported.
- The editable **Material** stage suggests an internal title from the actual topic and lists
  participants explicitly presented in the transcript, with literal evidence for confirmation.
  It does not label unlabeled utterances or identify voices. For long sources, metadata uses a
  bounded opening/middle/ending sample; it is not an exhaustive participant census. The full
  transcript remains intact and the article's source preparation reads every passage.
- The selected text provider proposes an outline; the person reviews it, generates an article, edits and marks it as
  reviewed, then manually approves an exact immutable version before generating carousel copy.
- Carousel copy uses the real template slots and limits. If the article has no literal quotation,
  an existing prose layout replaces a quote-shaped layout; indirect prose is not attributed as speech.
- Jobs, real provider model, reported usage, retry lineage, leases and fencing are persisted.
  Missing usage or monetary cost is not invented. No simulated provider fallback is used.
- Sources require authorization. Changed sources, brief, authorization, template or approved parent
  invalidate an in-flight result instead of silently associating it with older provenance.

The fixed server-owned `Operador local` is a development identity, not a login. It can manually
approve its own request only in this pilot. Ordinary membership retains the original two-person rule.

The local operator starts with the **Admin** test profile. A **Perfil de teste** selector at the
bottom-left of the sidebar offers **Editor**, **Aprovador** and **Admin**, without sign-out or
changing the acting identity. The same choices remain in the account menu (including the collapsed
sidebar), **Mais ações → Trocar perfil** inside productions, and ⌘K. Editor can create/edit/send;
Aprovador can review both articles and carousels; Admin carries all local pilot permissions.

The selected roles persist across requests, reloads and local tabs, while unsaved form text survives
a profile change. A local Editor can send to the same operator, then switch to Aprovador to decide;
Editor still cannot approve. The approval queue and next-step actions follow the current profile.
The server grants this capability only to the trusted loopback identity in the fixed local workspace
and explicitly refuses profile selection in cloud mode. Cloud membership roles replace checkpoint
roles and never gain the local approval exception. Normal members retain the two-person rule.

Approval continues the journey instead of leaving a dead end: an editor/all-roles operator goes
from the exact approved article to **Criar carrossel** (even before a carousel piece exists), then
from the approved carousel to **Entrega**. Article-only productions go directly to Entrega.
Review-only members continue to the next review or the approval list. Requesting adjustments
returns an editor to the matching studio; re-opening a decided review retains a next-step CTA.
No approval, export or publication occurs automatically merely by generating content.

## Prompt engineering and orchestration

Open `http://127.0.0.1:3002/config` or **Prompts** in the local sidebar. The page reads the active
server definition, not a frontend copy. Edit the shared system message, individual stage prompts,
provider/model, temperature and completion-token limit; select sequential or single-call article writing
and enable/disable outline evidence curation. **Salvar e ativar** creates a PostgreSQL revision.
Unsaved edits never affect execution. Conflicting saves from another tab are refused.

Each stage explicitly routes GPT OSS to Groq, GPT-4.1 to OpenAI Responses (`store: false`), or
Claude Sonnet 4.6 to Anthropic Messages. The `openai/` prefix on GPT OSS names does not mean the
OpenAI API is used. Claude temperature is limited to 0–1. Its JSON grammar subset receives length
constraints in schema descriptions; the original domain constraints are still validated before
checkpointing and persistence. There is no silent vendor fallback or hidden editorial prompt.
The config shows missing server credentials; an unsupported/unconfigured provider cannot enqueue
generation. Exact call model, request ID, settings revision and reported token usage remain recorded.

The default adapts the supplied **Reporter IA - Prompts do fluxo de artigos.docx**: outline,
curation, introduction and one call per section. Every section receives the actual preceding prose
and the remaining sections. The brief controls section count and character budgets, rather than
the reference's inconsistent fixed section count/word target. Existing source preparation and
approved-article carousel generation also have visible editable prompts. No external SEO research,
Make scenario, Sheets dependency, old provider/model or extra JSON-reformatting call was imported.

Article contracts reserve space for the actual section headings and allocate the remaining body
budget before writing. Sequential stages receive `sizing.outputParagraphs.maxCount` and
`maxCharsEach`, with the same limits in the stage schema. The editable writing prompts explicitly
respect those limits. Outputs exceeding them are rejected before caching or saving; text is never
silently cut to fit. A settings revision is activated through the regular command, not a seed reset.

The seed is **editorial prompts 2.0** (identified inside every stage and the shared system message).
It keeps the sequential Make approach, with distinct evidence-driven scopes for the opening and
each section, actual preceding prose as continuity rather than a factual source, no repetition to
reach the character budget, and explicit preservation of uncertainties and simulations. Evidence
extraction/curation use temperature 0.1, outline 0.2 and writing/carousel 0.3; all use 4,096 completion
tokens by default, except Material (temperature 0.1 and 2,048 tokens). These are editable settings, not hidden runtime instructions. The preset's
editorial version is separate from the database's monotonically increasing settings revision.
Carousel drafting targets 70% of each slot's character ceiling to leave room for model counting
errors; the original template ceilings are still enforced and never silently widened or truncated.
Changing the code seed never overwrites an existing active definition: activate it through the
same revision-checked `pipeline.save` command used by the page, preserving history.

Templates replace only the documented `{{variables}}`, once. Source text cannot recursively expand
variables, read environment credentials or execute code. The worker sends exactly the saved system
message and rendered stage template; there is no hidden editorial prefix in this connected path.
Required context variables, strict JSON contracts, source authorization, evidence identifiers,
length limits and manual approvals remain engine constraints. Replacing prompts does not remove
those checks or guarantee factual/model compliance; humans still review the resulting article.

Every new outline/article/carousel job snapshots the full active revision, including model and
parameters, **when queued**. A save affects subsequent jobs, not an already queued/in-flight job.
Each phase can therefore use a different revision if settings change between phases. The page shows
the last 20 versioned jobs, actual per-call hashes/models/request IDs in persisted traces, and the
last 20 previous settings revisions. A previous revision loads as a draft and must be saved to
reactivate. Retry checkpoints include prompts, model, parameters, schema and input in their key.
Structural outputs are validated before a checkpoint is reusable. Whole-episode preparation uses
passages of at most 6,000 characters (3,000 for dense summary passes) and enforces the same 50-fact contract in the provider request
and worker.
The editable source-preparation preset asks for up to 25 compact records (headroom below the hard
50-item contract) and real consolidation, including when its input is already a fact summary.
Quota pauses honor Retry-After, wait at least 30 seconds and preserve completed calls. They do not
spend the three-error retry budget, but the retry scheduling window is capped at five minutes.
An advertised wait beyond the remaining window terminates instead of scheduling hours of opaque
loading. The structure screen displays actual passage/call progress and quota waits; terminal
errors show a retry or model-change action. OpenAI billing quota exhaustion is not retried as a
temporary per-minute rate limit.
Manual retries may reuse validated checkpoints from their server-selected immediate retry parent
only with an identical request/schema hash. Unrelated edits to another stage do not invalidate
the exact source-preparation request; changes to its source, brief, messages, model, parameters or
schema do invalidate it. Each job still retains its immutable pipeline snapshot.
Legacy jobs without a settings snapshot cannot execute with silent defaults; retry them as new jobs.

Configuration/history live in the existing editorial aggregate; this feature adds no database table.
It is a local pilot control surface, not complete R7 multiworkspace prompt administration or an
arbitrary executable workflow/DAG builder. Legacy normalized article/carousel APIs remain separate;
these settings govern the approved connected UI's editorial jobs.

## Persistence and boundaries

Files stay privately in ignored `.reporter-local/`, never `public/`. Existing storage metadata,
`reporter_transcripts` and the outbox handle intake/audio. The approved UI's documents, versions,
approvals, activity, feedback, editorial jobs and bounded idempotency receipts are server-owned
`reporter_ed_*` rows (migrations 014–016, described in `database/README.md`). Named server commands
enforce the tested domain rules under scoped SQL functions; each loads only the rows it needs and
writes only the rows it changed, and browsers cannot upload replacement state. Migration 004's single
JSONB document per portal is retired by migration 016 and kept read-only for an emergency rollback.

Legacy `reporter_articles`/`reporter_carousels` APIs and data are preserved, but **new UI documents
are not mirrored into those tables**. The installed 20 tables include the existing Reporter foundation,
not 20 new editorial entities. Choose and migrate a canonical normalized model before multiuser release.
Logs in the existing UI read persisted semantic activity; sanitized technical logs go to stdout.
The editorial rows are not a permanent immutable compliance audit ledger.

Provider article bodies are committed atomically after validation. The editor reads that server
draft rather than replaying provider block events as browser-side writes; regeneration must not
append old AI paragraphs or mistake an event replay for a human edit. Simulated streaming is
unchanged. Existing immutable versions remain available for normal restore/review.
The autosave baseline includes review/provenance. TipTap's empty placeholder and a server-driven
title are not human edits: completed text appears automatically in an already-open empty editor.
Provider generation temporarily locks the editor; unsaved human text, title, image and review
changes otherwise remain protected. Paragraphs and slide body prose must finish a sentence before
caching/persistence. The visible prompts ask for concision and headroom, never automatic truncation.

## Live provider acceptance — 2026-10-10

Authenticated generation was exercised with OpenAI GPT-4.1 and Claude Sonnet 4.6; only uploaded
Reporter material and a clearly fictional audio sample were processed. The sample was uploaded
through the approved UI, transcribed with Groq, and presented two self-introduced participants
with evidence for confirmation. Its Claude-written article was manually reviewed and approved
only as a technical test. OpenAI generated five template-constrained slides from that exact
approved article; all five passed the rendered text-fit checks.

The real uploaded one-hour podcast completed whole-episode preparation and a reviewed outline.
Its OpenAI article completed in one attempt, with 2,857 body characters, eight paragraphs and
three headings. It remains an unreviewed draft: no approval or publication was performed.
Reloading the corrected editor displayed the pure server draft without appending previous runs.
No restore was necessary: the earlier mixed view was not the persisted draft.

At the user's request, a separate real-podcast production was created instead of replacing the
original. On revision 16 it completed in one attempt, with 2,796 body characters, seven paragraphs
and three headings. It appeared automatically and survived reload, remaining unreviewed/unapproved.
A separate OpenAI synthetic article (1,153 characters) also appeared in an already-open empty
editor without a reload. The final synthetic carousel generated five slides on revision 16; its
closing callout was shortened during manual editorial review, not silently repaired by the engine.

At that acceptance, settings revision 16 used Groq for audio and OpenAI for the editorial stages.
Claude remains an available option, not an automatic fallback. Its short sample article succeeded,
but its long-article/slide attempts sometimes exceeded length contracts and were rejected; this
is why it is not the active default. Changing provider or prompts still uses the same revisioned
configuration and immutable per-job snapshots. Passing this pilot does not promise every podcast
or provider response will succeed; evidence, names and factual accuracy still need human review.

Final local verification: quality gate (1,127 tests), backend suite (43 tests) and production build
passed. The approved design system/layout and the isolated Reporter PostgreSQL/Docker boundaries
were preserved. No login, S3, external publication, MediaOn dependency or new database table was added.

Old browser demo snapshots are untouched and not automatically imported. Reloading a production
reloads its saved documents/jobs. An incomplete file selection in the upload form is not restored
after a full browser reload; wait for transcription before reloading. "Cancelar envio" stops the
browser upload/wait, but an already queued job continues. Retrying in the same form reuses the upload.
Legacy uploaded/linked article assets still use the approved browser/IndexedDB implementation;
their metadata is not fully synchronized server-side. The later connected image-library feature
below stores its imported bytes and provenance privately on the server. No automatic publishing is performed.

`article.outline`, `article.draft`, `carousel.copy` and the article copilot actions described below
call the real configured provider. Carousel inline assistance remains explicitly unsupported;
it does not simulate success. Login/provisioning, S3,
cross-device assets, image-heavy delivery acceptance, DOCX ingestion/server exports, permanent audit
projection, retention, spend controls, public deployment and load testing remain deferred.

## Verify

Run `pnpm gate:quick`, `pnpm test:backend`, `pnpm db:test` and `pnpm build`.
DB tests roll back fixtures and compare the installed schema against a fresh official PostgreSQL
bootstrap in a temporary container without network, published ports or user volumes. The old
`pnpm smoke` covers the frontend-demo path, not live Groq; do not send its fixtures implicitly.
Live acceptance uses only an authorized upload or an agent-created synthetic sample, follows the
whole original UI flow, and reloads the saved production to check versions and provenance.
Hour-plus chunk coverage and the three-hour ceiling are unit-tested; that does not claim that a
real three-hour recording was sent to Groq during acceptance.

On 2026-10-10, an authorized real MP4 upload of 1,254,772,880 bytes and 3,944.907755 seconds
passed the corrected UTF-8 intake in the original creation UI. Groq completed all seven chunks;
the saved transcript has 62,419 characters and 1,457 timed segments, ending at 3,942.761 seconds.
The UI displayed the material as completed. Speaker identification/diarization was not claimed,
the material-authorization checkbox was left to the person, and no article approval/publication
was performed. This validates that particular 65-minute upload, not arbitrary media or load.

The subsequent real-podcast structure acceptance completed on settings revision 11: all ten
whole-episode source passages, outline generation and evidence curation completed with real Groq
responses. Three editable sections and the thematic headline appeared in the approved creation UI,
with references resolving to the original saved source. The source-preparation prompt was explicitly
activated through the settings command, preserving the other stages. No article draft, approval,
carousel or publication was triggered by that acceptance. Participant metadata was separately checked
against the uploaded transcript; a fictional two-participant sample verified suggestions, editable
titles, preservation of a human-written title and the details panel on desktop and 390px layouts.
## Generation feedback and image planning

Connected runs show recorded stages and elapsed time, support stopping, and follow the latest
generation across tabs. Provider output becomes editable only after validation; an empty draft
does not offer a second generation while the first is active. Invalid outputs stop after three
attempts; retry delays fit within a five-minute window rather than waiting thirty minutes.

Long-source preparation reads every passage, at most two in parallel, keeping source order.
Outline and article jobs reuse private facts checkpoints only for identical messages, model,
parameters, schema, source passage and brief. Editing an unrelated writing/image prompt does not
invalidate those exact preparation requests. Cached calls contribute zero new tokens.
Sequential writing remains available; the current revision 21 uses the existing single-call
article option with OpenAI to reduce latency. Both modes preserve the reviewed outline and validate
the full body ceiling before committing; single-call outputs are size-checked before caching too.
Transport schemas keep generous string limits so they cannot force a word cut at the editorial
budget. Sequential parts receive explicit character/word targets and are checked locally.

The editable `images` stage receives the written article and proposes a cover plus zero to two
inline image slots. Slots preserve their supporting paragraph references and suggest a subject,
caption, alt text and orientation. They are not photo files and do not assert credit or rights:
the existing picker accepts a local image or link with human-confirmed rights. Invalid image
plans or a 30-second image-stage timeout do not discard a valid article. Legacy immutable
pipeline snapshots without this stage continue to run unchanged.

On 2026-10-10, a separate authorized podcast test production completed revision 21 in its first
attempt in 28.805 seconds after transcription: ten source passages, a complete single-call article,
one cover suggestion and two inline suggestions. The 1,435-character draft has complete sentences,
three reviewed-outline headings and supporting references; it remains unreviewed with no approval
or publication. The original production was untouched. Reload preserved the result and the existing
picker opened with the generated subject, caption and alt text, blank credit and unauthorized rights.
This is a measured result for that test, not an ETA or a guarantee for other recordings.
The final quality gate passed 1,130 tests, the backend suite passed 50 tests, and the production
build passed. Claude was not used for this podcast; no new-provider permission was assumed.

## R1 article contract and live writing

The later R1 contract supersedes the historical short-draft acceptance above: the BODY must
simultaneously contain 2,500–4,000 characters with spaces and 500–800 words. Counting uses the
same NFC/code-point and Unicode-word functions as the editor, includes headings and quotations,
and excludes the title, image captions, credits and line breaks. Aim for 3,900 characters and
approximately 700 words. The legacy 2,000-character `short` option remains readable in old
records but cannot be used for new connected article generation. Never invent or repeat facts
to fill space; an insufficient source/invalid response is a visible failure, not a finished article.

Every R1 article requires at least two distinct substantive direct quotations. Every quoted
excerpt is checked against its own referenced original passage, allowing only whitespace and
Unicode composition normalization, not paraphrases, invented words or elisions. Long-source
summaries travel alongside original selected `literalEvidence`, and cannot act as literal
quotation evidence. Unidentified audio voices remain unnamed; participant introductions do
not prove who spoke a later sentence. Manual changes are rechecked before requesting approval.

Both single-call and sequential writing validate before final blocks/versions are committed;
single-call checkpoints additionally validate before caching or reuse. Several full paragraphs
are allowed per section. Single-call writing permits at most one measured near-target refinement
through `sizing.revisionFeedback` in the saved article template, never a hidden system prefix.
The transcript and reviewed outline remain factual/structural authority, not the previous draft.

OpenAI writing uses GPT-6 Astra through Responses with low reasoning, no unsupported temperature,
`store: false`, and genuine `response.output_text.delta` streaming. The live read-only preview
is checkpointed separately from the draft/version and never triggers editor autosave. It clears
on failure/cancellation and becomes editable only after full validation. Browser polling presents
those real provider increments; no fake typing animation or simulated post-response stream is used.
Groq transcription remains unchanged. Source excerpts in the outline are now visible text with
expand/collapse controls, not timestamps with tooltip-only phrases. Existing DS primitives and
the approved creation/studio layout are preserved.

The final authorized R1 podcast acceptance used a separate test production, settings revision 24,
and OpenAI GPT-6 Astra. It completed in 37.648 seconds on the first attempt, with 23 genuine
preview checkpoints (the first after 15.246 seconds), 3,662 body characters, 595 words and two
distinct literal quotations verified against their own original transcript references. The
first article response already exceeded the near-target threshold, so no refinement request
was needed. One cover and two inline image suggestions were preserved as suggestions, not files.
The existing test version and the user's original production remained unchanged; nothing was
approved or published. These are observed results for that podcast, not a latency guarantee.
Live unsaved editor changes use the same mandatory length/quotation checks as the backend,
including direct quotations inside headings and lists. A failed check blocks sending for approval.
The final gate passed 1,144 application tests and 56 backend tests, and the production build passed.
Browser QA verified visible transcript phrases on desktop and 390px width, expansion/collapse of
the complete excerpt, no page-level horizontal overflow and no console errors in the final structure
test tab. Section budgets/actions sit below the excerpts so they do not consume reading width.

## Editorial image library and designed banners — 2026-10-11

Open **Imagens** (`/images`) for the shared editorial library, or choose **Biblioteca** inside
the existing article image picker. **Banners** (`/banners`) opens the separate composition studio;
the article's menu offers **Criar banner do artigo salvo** in a new tab without discarding unsaved
editor changes. These features preserve the public Design System v3 primitives and the existing
creation/article design. The carousel slide renderer has not been replaced by the banner studio.

The user selected **Pixabay** for free commercial article/banner photography without mandatory
published photo credits. New search offers only Pixabay. Unsplash, Pexels and Commons adapters
remain solely for compatibility with existing source records, not automatic substitutes.
The presets use seafood-specific single terms: seafood, fishing, aquaculture, shrimp, salmon
and tuna. Broad descriptive multiword searches produced unrelated results in live QA and were
replaced; manual search remains available. This is a
curated selection workflow, not automatic semantic matching or proof that a generic photo depicts
the fair, the podcast guest or Seafood Brasil. Seafood-specific coverage still needs human review.
Pixabay search requests photographs, horizontal orientation, safe search and originals at least
2400×1350px, preserving popular ordering. The optional editorial-selection filter starts enabled;
turn it off to broaden sparse seafood searches. No aesthetic score or relevance guarantee is invented.
Original-download access is checked separately: ordinary API results expose only reduced images
up to 1280px. Without `imageURL`, show the preview and original dimensions honestly, disable import,
and direct the person to request full API access. Metadata alone never proves the downloaded size:
imports additionally validate decoded pixels after conversion, without enlargement.
Wallpapers describe the
desired look of editorial covers; this is not a wallpaper-distribution app or permission to reuse
unlicensed images. Beautiful stock photography is illustrative, not evidence of a real news event.

Add `PIXABAY_API_KEY` to the primary project's `.env.local`, then restart the Next.js server.
The blank slot is prepared at the top of that file. Obtain the key and request full-resolution
API access through [Pixabay API documentation](https://pixabay.com/api/docs/); approval is not
guaranteed. The key stays server-only, including the provider-required request query parameter:
it never appears in browser URLs, stock metadata, exports or reflected error messages. Identical
API responses are cached for 24 hours using a credential fingerprint, with bounded entries.
Never use `NEXT_PUBLIC_`, paste credentials into Prompts or commit them. Missing credentials show
an actionable configuration notice, never fake photos or a silent provider fallback.

Pixabay allows free commercial use and adaptation without required attribution, subject to its
[Content License](https://pixabay.com/service/license-summary/) and [Terms](https://pixabay.com/service/terms/).
The library identifies Pixabay as the source, as requested by the API; that is separate from a
published photo credit. Search previews may use its URLs temporarily. Selected originals are
downloaded to private local storage rather than permanently hotlinked. Article credits start
empty and optional, and no missing-credit warning is raised for Pixabay; per-use authorization
still applies. Banner PNG/SVG art has no mandatory visible credit, while author/source/licence
remain in internal provenance and SVG/JSON metadata. Paid sponsored results are not imported.
Recognisable people, brands and properties still need context/rights review. Images must not be
presented as a real photo of the fair, quoted guest or Seafood Brasil without evidence.

For legacy Unsplash assets only, unchanged photos are hotlinked from its CDN in both saved library previews and article
assets, with the API view identifier retained. Canonical photographer attribution links to the
profile with referral parameters, including article figure/cover legends in the existing Prose
serialization; these display-only links never change article content or history. Confirmed imports
and explicit reuses report the API's returned download endpoint, not searches or preview refreshes.
Downloaded local bytes are only used for derivative banner compositions. Unsplash expressly
exempts remixed creative derivatives from hotlinking; the unchanged-photo file endpoint redirects
to the CDN rather than rehosting that photo. The existing library and banners are preserved.
See [hotlinking and derivative exception](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images).

The Openverse adapter currently limits results to Wikimedia Commons JPEG/PNG/WebP with CC BY,
CC0 or public-domain metadata, rejects missing CC BY authors and noncommercial/no-derivatives/
share-alike licences, and preserves title, author, source and licence links. Wikimedia search
previews use its documented 500px step and current thumbnail host, not the failing Openverse proxy:
[thumbnail sizes](https://www.mediawiki.org/wiki/Common_thumbnail_sizes),
[thumbnail-domain migration](https://phabricator.wikimedia.org/T439443).
Before import, a person must confirm the licence and intended editorial use. This does not replace
legal review or releases for people, properties and trademarks. The article credit/note retains
provenance; PNG exports show attribution/licence and modification, while SVG metadata and the
downloadable JSON retain the original source. Keep those credits with downstream delivery.

When selecting a library photo for an article, untouched AI image-description suggestions are
replaced with the actual source identification; human-written alt/caption edits are preserved.
Legacy canonical credits remain read-only during selection; Pixabay credit is optional and editable. Authorization starts
unchecked for this use, even if the photo was previously admitted to the library. Confirm the
context and revise the source-language identification into an appropriate caption before delivery.

Only canonical provider IDs may be imported. The server re-fetches source metadata, uses fixed
HTTPS hosts without redirects, caps downloaded images at 10 MiB/40 million input pixels and
normalizes selected images to private JPEGs of at most 3840px without enlargement, still capped
at 10 MiB after conversion. This preserves larger cover assets without promising that every image
is 4K or changing the banner export formats. Search is bounded and cached;
the adapter does not mass-download the stock catalog. Imported files remain in ignored
`.reporter-local/`, with checksum validation on read. Library records and banner drafts use the
existing PostgreSQL editorial aggregate; no new database tables or migration were added.
The local pilot limits the library to 1000 images and 500 banner drafts and retains the existing
aggregate bound. Public/multiuser deployment and fine-grained normalized asset storage remain deferred.

Three deterministic designed compositions are available: photographic cover, editorial headline
and literal quotation. Formats are 1080×1350, 1080×1080, 1080×1920 and 1200×630. Brand name,
palette, headline, supporting copy, CTA and selected photo are editable, with a real debounced
server-rendered PNG preview. Saving validates layout before persisting; overflow is refused rather
than silently cutting text. Saves use optimistic revisions and canonical JSON equality so an exact
network retry is idempotent despite PostgreSQL JSONB property reordering. Unsaved composition
changes have a leave guard. After saving, download PNG, self-contained SVG and composition/credits JSON.

Quotation banners can only select a literal excerpt from a saved article whose quotation evidence
passes the R1 checker; the person's attribution remains a separate confirmation. A fabricated
quote is rejected by both preview and save. These are unapproved creative drafts: no publishing,
article approval or campaign delivery occurs automatically. No new AI key is required to render
these layouts. The initial creative palettes are not the client's official identity: the official
logo/brand guidelines and final art direction still need to be supplied and validated.

Live endpoint acceptance searched the real no-key Openverse source, imported one CC BY photo and
saved/exported all three banner templates. Repeated imports/saves were idempotent, invented quotes
and conflicting writes were rejected, and both the original user production and the separate R1
article-test record were unchanged. The photo was a clearly identified fish market in Tanzania,
used only for technical testing, not presented as an approved Seafood Brasil campaign photo.

Final verification passed 1,146 application tests, 64 backend tests and the production build.
Browser QA verified real search thumbnails, missing-key UI, shared article selection, canonical
credit, replacement of untouched AI descriptions, unchecked per-use authorization, real banner
preview, save-to-revision-2 persistence, unsaved-change guard and a downloaded 1080×1350 PNG.
Desktop and reduced-width layouts were checked for overflow. Temporary image selections were
discarded without editing either article; the user's original production checksum and the R1
test article's 3,662 characters, 595 words, two verified quotes and two versions were unchanged.
Temporary test tabs were closed and the browser viewport override was reset.

Cover-quality correction: the technical Tanzania photo and all saved banners were preserved,
but the library now opens on Pexels cover search rather than that saved test photo. Verification
passed 1,148 application tests, 65 backend tests and a production build. Desktop browser QA
confirmed the new default, larger-photo selection controls, explicit documentary alternative and
missing-key state (including the Enter shortcut). The original production checksum and the R1
test article were unchanged, and the worker was online. Actual Pexels photos, visual curation and
authenticated imports remain unverified until `PEXELS_API_KEY` is supplied; high resolution alone
does not guarantee composition, relevance or photographic quality.

Unsplash replacement after Pexels paused issuing new API keys: 1,151 application tests,
69 backend tests and the production build passed. Browser QA confirmed Unsplash as the
default, the Access Key setup notice and disabled search without credentials; the approved
design-system components and layout were retained. Existing images and all three banners
were preserved, including the original photographic banner at revision 2. The original
production checksum and R1 article checks passed unchanged; the worker remained online.
Provider tests used synthetic responses only. Authenticated Unsplash search, real seafood
photo quality and live selection/import remain unverified until `UNSPLASH_ACCESS_KEY` is supplied.
The blank key entry is prepared in the primary project's `.env.local`; no existing secret
was displayed or replaced.

Pixabay acceptance — 2026-10-11: 1,153 application tests, 77 backend tests and the production
build passed. The integration updated the stock adapter, visual-library domain/port, shared
library UI, article picker/credit checks, cover/delivery metadata and banner renderer, reusing
only existing Design System primitives. Lint reported no errors and one existing unused-variable
warning in `studio-model.test.ts`.

The configured server key successfully searched the live API. Desktop browser QA displayed
15 editorial-selection photos for `seafood`, with shorter metadata titles, original dimensions,
uncropped previews and a clear original-access warning. The account did not expose any original
download URLs; no real Pixabay original was imported or used in an article/banner. Full API
access must be approved before that end-to-end acceptance can occur. Synthetic tests cover
both original-enabled and preview-only responses, exact IDs, separate curation caches, 24-hour
expiry, the final 500-result page, actual decoded-pixel checks and banner output without visible
credits while retaining provenance. A missing key remains an explicit unit-tested failure.

All existing images and three saved banners were preserved; the photographic banner stayed at
revision 2. The original production checksum, the separate R1 article's 3,662 characters,
595 words, two literal quotes and two versions remained unchanged; the worker stayed online.
No approval, publication, database migration or user-content transmission was performed.

## Connected article assistant — 2026-10-11

Article selection and document tools now run real `article.rewrite` (direct/didactic/formal),
`article.shorten`, `article.expand-from-source`, `article.to-list`, `article.titles`,
`article.subheadings`, `article.ask` and `article.apply-note` requests. They use the shared,
editable **Assistente** stage in Prompts (`/config`), not hidden tool-specific messages.
Settings revision 25 adds only that stage to revision 24, preserves every existing editorial
prompt/model and selects its existing OpenAI GPT-6 Astra model. Each job snapshots the exact
saved configuration; editing it affects new requests, never an already running job.

Inline requests use the saved article snapshot and pertinent literal transcript excerpts,
not another whole-podcast map/reduce. The provider is told that this is partial source coverage.
The server refuses forged/stale draft snapshots, invalid/overlapping targets and list conversion
of a partial paragraph before calling a provider. Returned changes are restricted to authorized
targets and known source references; inserted direct quotations must be literal, existing quoted
words cannot be paraphrased or removed, and a valid R1 article cannot leave its mandatory
character/word/quotation contract. Combined suggestions are checked too, not only each edit.
These mechanical checks do not prove every paraphrased claim; factual review remains necessary.
When there is no supported safe change, the assistant may explain that limitation without proposals.

The existing DS v3 conversation shows saving/sending, actual OpenAI streaming reply/proposal
previews, elapsed time, stop, recoverable errors/retry and provider provenance. A preview is never
an autosaved document, ready suggestion or new version. Only a validated completed result offers
accept/discard; accepting marks edited text unreviewed and retains/adds the actual source references.
Cancellation/failure clears unvalidated previews and fences late worker writes. Completed questions
and cancelled runs remain visible after reloading. No automatic vendor fallback, approval or publishing.

Live acceptance used a separate copy of the authorized Seafood podcast article. All eight request
kinds completed with real OpenAI responses, first attempts and uncached provider calls. Direct,
formal and didactic rewriting, shorten, list, expansion and titles took approximately 8–24 seconds
in these observations; intertitles took 37 seconds including queue/validation. These are measurements,
not promises. Every tested run exposed real preview checkpoints. The browser separately verified
a question without document changes, a custom selection-scoped rewrite accepted into only the test
draft, cancellation during real streaming with zero ready suggestions, and an actionable partial-list
selection refusal. Accept/discard and saved results were checked; nothing was approved or published.
The user's original production and the prior R1 test article remained unchanged.

The quality gate passed 1,155 application tests, the backend suite passed 87 tests and the production
build passed. Browser QA covered desktop and 390px width, with no page-level horizontal overflow.
The 21st CLI was unavailable; existing approved DS components and project design/architecture gates
were used. No design-system/layout replacement, login, database table/migration or MediaOn dependency
was introduced. Carousel inline AI tools remain a separate future connection.

## Seafood carousel variation library — 2026-10-13

The existing `/library/templates` now presents six Seafood-inspired editable creatives first:
Notícia (Seafood Manchete / Seafood Reportagem), Explica (Seafood Fluxo / Seafood Panorama),
and Podcast (Seafood Entrevista / Seafood Aspas). The shared family filter works on the library,
the writer's generation selector and the studio's switch drawer; family/model/search URLs can
be shared. The ten previous model IDs, the saved-choice priority and the existing default remain
compatible. No studio-shell redesign, new database table, migration, login or MediaOn dependency.

All seven page layouts are rendered from actual template data to PNG, not flattened mockups.
Compositions use photographic crops, large sans headlines, light/dark pacing, numbered lists,
data typography, quotation panels and a recurring angular footer. A typeset Seafood Brasil label
is used until the official client logo asset is supplied. New models are base entries, not labelled
as approved by Marketing. The exact selected template is retained by the connected editorial engine.
Switching preserves slot contents and source references and reports approximate text overflow.
Selecting a Podcast design does not invent quotations; generation still needs literal article evidence.

The demonstrative seafood photo is generated using the built-in image tool, without a project API
key; its complete prompt/provenance is saved alongside `public/samples/seafood-processing-sample.jpg`
in `seafood-processing-sample.provenance.json`. It is explicitly credited as an AI illustration in
library previews, not presented as a photo of a real event. Sample copy includes a bracketed quote
placeholder, not an invented participant's statement. Real carousel requests use the approved
article's selected cover only; missing/unreadable covers never fall back to this demo image.

Acceptance: 1,161 application tests, 87 backend tests and the production build passed; only the
pre-existing unused-variable lint warning remains. Browser QA covered family filtering, internal
page previews and 390px width without page-level horizontal overflow. A separate existing synthetic
technical carousel was switched to Seafood Fluxo and undone: its body returned to the exact original
SHA256, with unchanged version/decision counts. Only its draft revision advanced from 1 to 3.
The user's original podcast record SHA256 remained unchanged. No provider generation, approval or
publication was triggered by these tests. The 21st CLI was unavailable; catalogue inspiration,
existing DS primitives and the project's UI/architecture gates were used instead.

### Editorial-detail polish — 2026-10-13

The same six IDs now use a consistent 84px safe margin, larger optical headlines, balanced line
breaks, deliberate photo crop anchors, lighter brand signatures and refined quotation punctuation.
Font fitting has an explicit floor and never modifies copy. If text still cannot fit, overflow
remains visible; legacy models retain their original fixed-size/greedy-wrap defaults. Tests also
reserve room above the signature and reject overlapping text boxes.

Library cards draw sharper 648px thumbnails and are larger on desktop. Each page can be expanded
into a DS Dialog at a legible size, with previous/next and return controls. The viewer is a sibling
of the model drawer so Escape closes only the top layer and restores focus to its opener. It holds
the exact rendered preview snapshot, not a new article/carousel version. Illustrative notices stay
on library samples, not the writer's actual carousel. No new preview-download shortcut ships:
download events were not confirmed in the embedded browser; approved exports retain their existing flow.

Local acceptance also revealed stale JavaScript across rebuilds. `pnpm build` now gives each build
one public `NEXT_DEPLOYMENT_ID`, inherited by its build workers; an explicitly supplied release id
wins. `next start` reads that same id from Next's generated server manifest. Static asset URLs are
versioned and client navigation receives matching deployment headers. No credentials were changed
or made public. This follows the installed Next 16.3.8 deployment-id contract, not a custom cache layer.

Acceptance passed 1,171 application tests, 87 backend tests and the production build. Desktop and
390px browser checks covered enlarged pages, keyboard navigation, single-layer Escape, focus return
and no horizontal overflow. The original podcast checksum stayed unchanged. No provider call,
approval or publication was initiated by this polish. The 21st CLI remained unavailable; the work
used catalogue references and the existing public DS components with the project's quality gates.

### Preview viewport correction — 2026-10-13

The enlarged-page viewer now reserves viewport height for the DS dialog chrome, including its
two-row mobile footer, and caps the artwork at 540px to respect the dialog's 760px maximum height.
Only the display frame shrinks: the exact 810px rendered PNG snapshot is retained. The arrow
buttons and numeric counter are direct children of the existing centered DS footer, rather than
embedding interactive controls in a metadata list. No local CSS or new UI primitives were added.

The full gate passed 1,171 tests and the production build. Browser measurements at 1280×720,
1280×560, 390×600, 390×844 and 880×1251 confirmed no preview-body scroll, complete dialog visibility
and matching vertical centers for the counter and both arrows. Keyboard page navigation, the
disabled final-page arrow, single-layer Escape with focus return, and “Voltar ao modelo” were
verified. The old embedded-browser tab retained previous code after reload; acceptance used a
fresh tab of the versioned build. No production content, provider configuration or export changed.

## Article reliability, automatic photos and Citações — 2026-10-13

Connected command writes retain their successful result if only the following workspace refresh
fails. An identical manual retry after an ambiguous transport error reuses its request identity.
Outline reference IDs, section counts and approved titles are validated before caching. Article
length repair remains bounded and measured against the hard R1 rules; failure of an optional
near-maximum refinement preserves an already-valid article, never an invalid or truncated one.

The worker searches Pixabay for generic public seafood-topic keywords after image planning, then
imports distinct licensed original photographs through the private image library. Existing editor,
cover, carousel and export asset ports can resolve the resulting server assets in a fresh browser.
Image captions describe the actual selected photo as illustrative, not a photograph of the podcast
participants or a real event. The editor can retry automatic image search without regenerating
the article; source authorization, role, draft revision and content hash are checked before writing.
The current Pixabay key returns reduced previews but no original URLs. As chosen by the user, the
minimum remains 2,400 × 1,350 pixels: no enlargement, reduced-preview import or vendor substitution.
Full Pixabay API access is still required for live automatic insertion. Its absence is an actionable
image-slot warning, not an article-generation failure.

The R1 Citações menu projects literal quotations already used in authorized article drafts/versions
and supports additional manually selected transcript passages. Generated quotations are emphasized
in the article without changing text, counts or source references. Each entry retains the transcript
version, segment, content hash, available timestamp and production. The library stores editorial
curation as citation rows among the editorial rows; no login was introduced.
Participant introductions are not evidence of voice attribution: authors must be verified from
speaker-labelled material or explicitly confirmed by an editor. Unknown podcast/date/location/link
remain visibly unknown. Only a verified literal passage with confirmed author and a written relevance
note is marked Selecionada. This is curation, not publication or article approval.

Live acceptance used a new fully synthetic production, not a copy over the user's podcast. Outline,
curation and OpenAI article generation completed with 3,637 characters, 586 words and two literal
quotations; the hard R1 policy passed. Both statements appeared in Citações, and missing original
photos produced the expected PIXABAY_ORIGINAL_REQUIRED warning while preserving the article.
API checks rejected an invented quotation and verified idempotent curation retries, restoring the
synthetic entry to pending curation afterward. The original podcast record SHA256 stayed unchanged;
nothing was approved or published. Acceptance passed 1,178 application tests and 94 backend tests.
The final production build passed. Browser QA covered search and curation filters, full quote
context, the material-source next step, an invalid manual quote with retained fields, visible bold
article quotations, the actionable Pixabay warning, Escape/focus return and 390px width without
horizontal page overflow. A fresh tab was required because the previously open embedded-browser
tab retained old chunks after reload. The 21st CLI was unavailable; catalogue inspiration and the
existing approved public DS components guided the new interface, with no local CSS or shell redesign.



## Pauta directly to the editor — 2026-10-14

New production has two form steps, Material and Pauta. “Gerar artigo” saves the authorized source
and production, enqueues one article run and opens `/productions/[id]/article` directly. A refused
queue start preserves the saved production in the editor, where generation can be retried. Legacy
`/productions/new?producao=` links redirect to the same editor without creating another production.

An article draft without a reviewed outline now plans its sections and selects evidence within
its immutable pipeline revision before writing. The existing literal-reference, section-count,
quote and whole-article R1 validation remains mandatory; supplied outlines retain their existing
path. Provider availability checks include the automatic planner and optional quotation curator.
Retries reuse compatible cached planning and writing calls. No migration or new key is required.

Preparation uses the existing editor chrome with an indeterminate progress bar and animated
paragraph placeholders; received text replaces them in the live preview. Detailed run steps remain
available in the existing trace drawer. Reloading attaches to the saved run without enqueueing a
second one. Local real-service acceptance created one synthetic article: automatic outline and
curation, streamed writing and bounded length refinement completed with 3,877 body characters,
661 words, one saved version and valid literal citations. A reload during preparation kept exactly
one generation request. Desktop and 390px QA reported no console errors or horizontal overflow.
Live configuration and deployment were left for the user's release process.
