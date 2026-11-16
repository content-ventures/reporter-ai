# Live acceptance: Amanda and Léo feedback

Date: November 16, 2026. Production: v1.9.0, commit
`c7f554bbd44b6d74cfc360da9f892bb79fe983eb`.

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

## Reproduced defects and local corrections awaiting release

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

These local checks do not establish that the corrections are deployed.

## Remaining live acceptance

- Release the correction and repeat dark appearance/logo/reload plus table edit/save/reload
  against the new production commit.
- Run actual multipart audio ingestion/transcription and a real two-event recording. The
  automated connected tests cover ordering/failure/retry, but this session used supplied text.
- Verify every metadata field and table export against the corrected live server.
- Exercise reviewed external text → human approval → real carousel → download in production.
  The full fixture path passed; no teammate was notified and no approval gate was bypassed.
- Amanda/Léo must judge the writing against the real fair workflow and accept its variety,
  useful structure, attribution and actual generation time. Four successful text-based drafts
  do not prove every event format or carousel has passed editorial acceptance.

No separate Fenacam workspace is required for any remaining check. Semrush validation and
WordPress/Yoast publishing remain manual, as agreed in the meeting.
