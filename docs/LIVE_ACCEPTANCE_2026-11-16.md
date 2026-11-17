# Live acceptance: Amanda and Léo feedback

Date: November 16, 2026. Initial acceptance used v1.9.0, commit
`c7f554bbd44b6d74cfc360da9f892bb79fe983eb`. The corrections were subsequently
released as **v1.9.1**, commit `80fe865716d87dda4a3aa48ea4821e1053cef8fa`, and
the authenticated production observations below were repeated on that release.

## Scope and identity

Testing used the existing Chrome Work profile for joaovitor@oranj.com.br and its existing
Reporter IA session (Admin Teste), at `https://reporteria.contentventures.com.br/w/reporter-ai/`.
The workspace is **Seafood Brasil**. Its writing guide, prompts and configuration were retained.
An initially created, empty QA workspace was archived after João rejected creating a separate
Fenacam workspace. It contains no productions or copied configuration and is not used for tests.

Only new QA drafts were edited. Existing newsroom productions were not changed, regenerated,
approved or published. No review notifications were sent to other members.

## Observed on production

| Check | Observation |
| --- | --- |
| Entry and navigation | Nova produção is available in the sidebar and page header; creation has back/cancel controls. |
| Categories and formats | Selected Site, Cobertura feiras, Redes sociais, Vídeo e podcasts. Confirmed Hard News/evergreen/publieditorial/launch/newsletter; stand/panel/congress/award/opening; post/carousel; script/YouTube description. |
| Fair/source context | Event, company and session fields accepted the truthful podcast context. No invented attendance at Fenacam was supplied. |
| Supplied file | Uploaded a 6,172-character excerpt of the user-supplied Brusinox EP08 reference. File reading and material analysis completed; 11 segments and two named guests were identified. |
| More participants | Manually added the host as a third participant with no technical speech attributed to him. The UI retained evidence and distinguished introduced people from attributed voices. |
| Multiple topics and formats | Two topics × Hard News/evergreen saved four independent productions and started four real provider generations. All four completed as saved drafts. |
| Size and structure | All four results had four subtitles and remained below the requested 1,800-character ceiling. |
| Editorial focus and variation | Demand-planning texts stayed on planning; processing texts stayed on efficiency. Hard News and evergreen opened differently. Named guests and quoted passages matched the supplied excerpt; no fair attendance was invented. This is a bounded review, not reporter approval of all future output. |
| Publication metadata | Added a QA linha fina to the efficiency Hard News draft, saved, reloaded and confirmed it in the article. Other generated metadata fields were present. |
| Public page import | Imported the actual Seafood article “Automação industrial de pescado: como planejar uma planta que cresce com controle”; the app obtained roughly 11 KB, identified three participants and retained “Abrir fonte original”. No production was created from this intake. |
| Complementary text | Added an excerpt from the supplied EP08 reference alongside the imported page; both materials remained present. This intake remains a session draft, not a generated article. |

The supplied EP08 reference is
[Seafood-Podcast-Industria-Ep-08-artigos-SEO](https://docs.google.com/document/d/1K80koDlJ6dBzzy4alTPBxrRasBjIsIDT1h5uZW-vz4s/edit).
The public-page test used
[the Seafood article](https://www.seafoodbrasil.com.br/conteudos-patrocinados/automacao-industrial-de-pescado-como-planejar-uma-planta-que-cresce-com-controle/).
Source contents are editorial data, never instructions to the assistant.

| QA production | ID | Observed character count | Subtitles |
| --- | --- | ---: | ---: |
| Demand planning · Hard News | `65a04efc-f8f1-4ad6-bb48-5560f5b71d8a` | 1,565 / 1,800 | 4 |
| Processing efficiency · Hard News | `089c0f7a-32b7-4e55-b1bc-86fbdded1a11` | 1,498 / 1,800 | 4 |
| Demand planning · Evergreen | `b899ee47-814a-4178-8c90-032d81a0e368` | 1,502 / 1,800 | 4 |
| Processing efficiency · Evergreen | `f80cefcd-20a2-4eeb-b0a6-c545a859f19c` | 1,497 / 1,800 | 4 |

All article titles begin with “QA —”. Counts are the editor's body measurements, excluding
title, linha fina and image suggestions. The exact elapsed generation time was not captured;
all four were complete at inspection. No numeric latency target or benchmark is claimed.

## Defects reproduced on v1.9.0 and corrected in v1.9.1

1. **Dark logo contrast:** the production wordmark remains graphite on the dark sidebar and
   is barely visible. Both existing SVG wordmarks now adapt their lettering to the parent's
   color scheme, preserving the blue symbol and all paths/dimensions.
2. **Theme on reload:** the old preference was browser-only, so server HTML could begin in
   the system theme before hydration. A validated preference cookie now supplies the public
   DS ThemeV3 at render time. Legacy local storage is migrated, and light/dark/system remain
   available. Pages now render on demand to read the preference; no new theme or CSS was added.
3. **Table saving:** inserting a table produced a 422 `INVALID_INPUT` from the production
   workspace command endpoint, and retry also failed. The server's draft block allowlist
   omitted `table`. It now accepts rectangular tables and validates row/cell/text limits.
   The temporary table and typing used to reproduce the issue were undone; after reload,
   the QA article retained its original prose and saved linha fina.
4. **Public-link progress:** web pages were incorrectly called “Episódio do Spotify”. The
   progress now distinguishes web/YouTube/Spotify and starts with “Importando link”. A page
   without enough extractable text now uses the public-source error and paste/file fallback,
   rather than reporting an empty transcript. The non-www home page failed this extraction;
   the actual www article imported successfully. No claim is made that every public page
   exposes readable content.

## Local validation

- Complete `pnpm gate`: **1,910 tests**, repository policies, lint, types and a real production
  build passed. Existing lint warnings are unchanged.
- Backend suite: **393 passed**, including new server draft-input tests for valid/empty cells
  and malformed, uneven or excessive table payloads.
- Six appearance browser tests passed: real wordmark pixel contrast for four app/OS theme
  combinations; reload and 390px overflow checks; saved dark rendering with JavaScript
  disabled; migration of the legacy preference. Clean desktop/mobile screenshots were inspected.
- **77 fixture browser cases passed**, covering article/model routes, metadata/linha fina,
  table edits/reload, reviewed-text fidelity and approval → carousel → export.
- The fixture build was disposable. The final build was made without the fixture flag.
- 21st review was rerun: no findings in changed appearance code. Existing findings were a
  comment containing `<img>`, a hash mistaken for a color and the existing approval-dialog
  autofocus warning. The first two are false positives, not new product defects.

Those local checks alone did not establish deployment. PR #66 was then merged with rebase;
controlled production run 43966907639, attempt 2, passed every stage. Both production domains
reported v1.9.1 and the exact release commit. The first attempt stopped safely on a staging
worker source mismatch; retry preserved the readiness guard and passed.

## Authenticated acceptance on v1.9.1

Testing continued in the same Chrome Work @oranj session and existing Seafood Brasil workspace.
All 13 writing-guide values matched their pre-release values. No workspace was created, no
team production was changed, and all approval requests below were assigned to Admin Teste itself.

| Check | Observed result |
| --- | --- |
| Appearance | Dark wordmark visibly white/blue; light wordmark graphite/blue. Light, system and dark preferences each survived reload. Restored the original dark preference. |
| Formats/context | Selected all four categories and every delivered format; material remained available while switching. Fair/company/session context controls were present. |
| Public link | Reimported the real Seafood article, completed analysis and opened its actual original page. Progress identified a web page. One legacy HTTP status still briefly says “Localizando episódio”; this does not prove every progress label is corrected. |
| Reviewed-text import | Uploaded the supplied EP08 excerpt. Normalized text length 6,150 and FNV-1a hash 1,474,485,007 matched the imported article before manual edits. It opened as an unapproved draft, without an AI rewrite. |
| Manual participant | Added Pedro Carnevalli with role and organization; it retained zero attributed speech. Removed this temporary row before creation. |
| Table | Inserted and edited a 3×2 table with participant/organization headers and the two source-backed guest/company rows. Save completed; every cell remained after reload. |
| Publication | Edited search title, description, linha fina, slug, primary/secondary keywords and intent. Saved and verified all seven fields after reload. |
| Character limit | Changed the article brief to 12,000 characters and four subtitles; the editor retained the 12,000-character ceiling after reload. This edited brief does not rewrite the already imported source. |
| Human approval/carousel | Sent the reviewed QA article to Admin Teste, approved through the actual dialog, generated five Seafood Explica V2 slides, inspected all text/source references, edited the final CTA, reloaded, and approved the actual carousel through the normal self-review flow. |
| Download | Downloaded all nine package files. Both article exports retain the semantic table and its factual cells; Markdown carries all seven SEO fields. All five PNGs decode at 1080×1350. Manifest identifies the QA production and actual article/carousel decisions. |
| Multipart audio | Uploaded two consecutive halves of the supplied EP07 clip. Both completed transcription/analysis, yielding 10 segments and 136 words. Reversed the order and restored it through the visible menus; the combined transcript retained the chronological boundary at 00:26. |
| Real audio-based writing | Fast writing completed a new, saved QA draft with 640/1,000 characters and one subtitle. The source's unknown voice remained unnamed; no fair attendance, organization, date or investment announcement was invented. Reload retained the draft and QA title. |
| Observed timings | The actual run panels recorded 14 seconds for this short audio-based article and 13 seconds for this five-slide carousel. These measurements exclude transcription and are not a general latency guarantee. |
| Phone | Inspected Material → Pauta and the generated article at 390×844. Found a clipped disabled Continue button when the authorization reason shares its footer row; after authorization it fits and advances normally. The correction uses public DS ActionBar's wrapping reason and associated accessible description. |

New production evidence:

- Reviewed EP08 import → article approval → carousel approval → download:
  `22b87e02-47f5-40ce-9383-620cfc39f00a` (“QA — Importação revisada EP08”).
- Actual two-part EP07 audio → generated draft:
  `fa625c75-1da4-45fc-b234-770790057b8e` (“QA — Áudio em duas partes EP07”).
- Audio reference: the supplied Brusinox Drive clip
  `1eGUBZZxfVhrVU4Nqq8mCyh2RPuwZ3Tq_`, “Seafood Podcast Indústria - Ep.07 - Mauro Nakata - Corte03.mp4”.
  Its filename was not treated as proof of the voice's identity. The original media is 52.052
  seconds; the transcript's final speech ends around 00:44. Splitting the file does not create
  two distinct events, so this is not acceptance of a real two-event recording.

The new footer regression reproduces the old phone overflow (the action's right edge reaches
405.36 px in a 390 px viewport) while the desktop case passes. Against the correction, all eight
new-production browser cases pass, including both widths, source recovery and two topics × two
formats. The complete gate passes 1,910 tests and a production build; the deterministic 21st
review reports no findings. Production verification of this final footer correction completed on
v1.9.2 (`bf3cf69e9a7c7ecf35ad1fc207f44703484c8f51`): both domains reported the exact release,
and the real Work @oranj session showed the full disabled Continue button and wrapping reason at
390×844. The temporary input was cleared without creating another production.

## App-only dark appearance correction

The real QA delivery exposed white group-header bands in dark mode. Reporter used the current
public `ListGroup`, which supplies a fixed translucent white header surface. At João's explicit
request, the Design System and Reporter's dependency pin stay unchanged. An isolated local DS
experiment was stopped without a remote push, publication, or application to Reporter.

The app composes the existing public `FieldGroup` and labelled `List` in package files, pending
actions and archive uses. File contents, download/retry handlers, pending-action counts and
source navigation remain on their existing paths. There are no app CSS, new tokens or local
visual primitives. Empty/loading states retain the public list components.

Local production-fixture verification passed 79 browser cases: all R1 routes at 1440 and 390,
the full approval/export path, theme/logo persistence, and four added light/dark × desktop/phone
checks. The latter measure actual composited label contrast (at least 4.5:1), reject light group
surfaces in dark mode, retain the Casa Forma pending item and the article download, and check
overflow. Screenshots were inspected. The deterministic 21st review found no issues in the three
changed product components. This correction still requires its controlled release and live check.

## Remaining live acceptance

- Release and recheck the app-only group-header correction in the existing Seafood Brasil workspace.
- Test a real recording containing two distinct events. The multi-topic/multi-format batching
  and multipart ordering checks do not establish this editorial acceptance.
- Amanda/Léo must judge the writing against the real fair workflow and accept its variety,
  useful structure, attribution and actual generation time. Four successful text-based drafts
  do not prove every event format or carousel has passed editorial acceptance.

No separate Fenacam workspace is required for any remaining check. Semrush validation and
WordPress/Yoast publishing remain manual, as agreed in the meeting.
