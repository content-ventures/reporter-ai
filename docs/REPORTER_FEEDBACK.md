# Amanda and Léo feedback: implementation and acceptance

Audit date: November 16, 2026. The integration starts from current `main`,
`b9498ad200343c89aa683e8f2d7eef7cdffbbf78` (v1.8.0). The previous implementation on
`reporter-feedback` started from an older upload branch; its checks alone did not establish
compatibility with the current product. This delivery preserves current workspace/account
routing, permissions, editorial memory, writing orchestration and multipart media uploads.

## Source coverage

- Complete 27-page meeting transcript: `2026-11-13_11_02_38-transcript.pdf`.
- The supplied category list and Léo's written complaints and suggestions.
- [Fenacam scope](https://docs.google.com/spreadsheets/d/1DYmWngiMqvPxf31-fJG788iiVf7_d2f_xrPJH2MqeAc/edit), including the delivery and appointment rows.
- [Pedro's evergreen content plan](https://docs.google.com/document/d/1B5pCVUeT_RawW0XSaoSG8G_wCnFc1o_eTHKvX4NLkcc/edit).
- [Brusinox reference folder](https://drive.google.com/drive/u/0/folders/1xO0j7uuz5BTXglOlHZJ6_HJAc8_FAghr).

Document contents are requirements and editorial references, never executable instructions.
The message “Base do agente criado” does not include an agent configuration; exact reproduction
of that agent is not an established acceptance claim.

## Requirement checklist

“Implemented” below means local code and the indicated automated checks, not a production
release or Amanda/Léo's acceptance of generated prose.

| Request and meeting reference | Implemented behavior | Verification |
| --- | --- | --- |
| Categories before material; Hard News in Nova Produção (20:59, 37–41 min) | Site: Hard News, evergreen, publieditorial, launch; fair: stand, panel/talk, congress/seminar, award, opening; social: post, carousel; video/podcast: script, YouTube description. Newsletter is also available for the fair's daily summary. Each selected format/topic creates its own production and queues its writing; partial refusals retain saved work and show the actual initiated count. | Taxonomy/brief tests; desktop/mobile creation checks, including four independent jobs from two topics and two formats. |
| Clear entry and back action (14:21, 17:14 min) | Role-filtered Nova produção in the menu, existing homepage/command actions, explicit back controls, two-step progress and scroll reset. A session draft is restored within its account/workspace/view. | Navigation/permission tests; browser reload/back/mobile checks. |
| More participants; context before term correction (30–32 min) | Add/remove manually missed participants with name, role and organization; fair, company and session context before the correction controls. Registration never guesses which unlabeled voice spoke. | Form/participant tests and connected stand scenario. |
| Custom character limits; additional subtitles; no lauda sizing (33–36 min) | 300–30,000 characters and 1–20 subtitles, editable in creation and later in the brief. Historical records keep their contracts until edited. New contracts remove inherited word floors and do not pad short information. | Domain limits, outline, checks/approval and editor tests. |
| Slow writing, not transcription (10:58 min) | Optional fast writing snapshots a complete-article path with matching model checks and progress steps; skips optional quote curation. Literal-quote and source-memory verification remain active. | Run-definition/prompt tests; provider latency still requires real acceptance. |
| Links and original-source access | Public HTTPS pages, existing YouTube/Spotify intake, complementary text/files/links and explicitly requested web research. Original URLs remain accessible. | Actual connected link interaction; parser/IP/HTTP transport tests. |
| Multiple materials per production (37–41 min) | Keep the current ordered recording parts and add complementary material. Concurrent completed files do not overwrite one another. | Multi-part upload/reorder/failure browser checks; source tests. |
| Multiple events in one recording (26:13 min) | Editable main/secondary themes, instructions and separate productions for selected topics/formats, sharing evidence. Each production retains its own format and character ceiling. | Browser: 2 events × 2 formats → 4 productions, 1 source. |
| Recorte do conteúdo and subtitles (28:36 min) | Requested field names; flexible structure in creation and later editing. | Form/outline/editor tests. |
| Evergreen driven by a topic, variable count (45–55 min) | Topic-led guidance, editable theme suggestions, optional separate secondary themes, keyword/intent fields. Podcast/program/date/link travel as source context and may supply the final CTA. No fixed three-article rule. | Form batching and modern/legacy prompt propagation tests. |
| Different openings and composition (56 min) | Per-production instructions override historical format defaults while preserving truth/attribution rules; guidance asks for varied openings, development, lists and endings. | Prompt tests. Editorial variety requires reporter acceptance on real episodes. |
| Useful visual information, including tables (47–51 min) | Lists plus semantic editable tables with headers, persisted cells, HTML/Markdown/clipboard export and source references. Modern writing can return source-backed tables; row shape and literal quotes are validated. | Schema round trip, exports, length/quote checks, writing-output validation and browser editing/reload. |
| SEO/publication package (47–51 min, 1:06) | Editable search title, description, slug, main/secondary keywords, intent and linha fina. Linha fina also updates the article. Metadata follows versions and exports. Real text measurements are shown without pretending to be a Yoast score. | Hash/schema tests; browser save/reload. |
| Structured form plus exceptions/chat (59 min–1:13) | Per-production instructions, explicit optional browser defaults scoped to account/workspace/view, and the existing article assistant. | Prompt tests and draft recovery checks. |
| Dark appearance (56 min) | Persisted light/dark/system modes through public Design System V3. | Browser preference/reload checks. |
| External article → carousel fallback (45:56 min) | Import supplied text without AI rewriting or automatic approval; revise and approve, then use the existing carousel/model/approval/export path. | Import fidelity/metadata checks plus the complete approval → carousel → export browser path. |
| Seafood terminology (1:21) | Writing guidance uses “pescado” and “País” for Brazil. | Prompt inspection/tests; final copy remains editorially reviewed. |

All visual UI composes public Design System V3 components. The table schema is document data
inside public `Prose`, without node views, custom CSS, tokens or a new UI dependency. Network
routes retain authenticated same-origin capability checks. Public-page intake validates all
resolved IPs, pins the TLS destination and repeats validation on redirects. Planning/research
use the transport bound to the initiating workspace/account, including member-view context.

## Fenacam: what the reporters must deliver

The spreadsheet schedules **12 podcast + article + carousel sets across November 18–20**;
they are not all due on Wednesday, November 18. It also lists **3 newsletters** and **10 portal
notes** across the coverage. Each episode needs a one-minute introductory video plus guest and
recording photos; Phibro additionally needs its feed video. The daily plan includes a 45–60-second
reel and up to five stories, including its repost; selected podcast stories replace other slots.

Wednesday's listed appointments include Bahia Pesca at 15:00 and an extra ADM slot at 16:00.
Phibro's time remains inconsistent in the supplied schedule and needs the reporting team's
confirmation. Do not turn that uncertainty into a confirmed booking.

Reporter IA can help turn authorized recordings/material into selected notes, topic articles,
carousel copy, scripts, descriptions, newsletters and publication metadata, with human review.
It does not record the podcast, take photos, film/edit/publish the reel, confirm appointments,
or execute the physical fair coverage. No such operational delivery was performed here.

## Verification and remaining acceptance

- `pnpm gate`: repository policies, lint, types, unit tests and production compilation.
- `pnpm test:backend`: connected transport, intake, worker and writing contracts.
- Connected browser suite: material progress, actual link import, failures/retry, ordered media,
  event context and multi-event/multi-format batching, at 1,440 and 390 pixels. Touch reorder's
  desktop-keyboard case is intentionally skipped on the phone.
- Fixture production-build suite: article/model routes, approval → carousel → export, reviewed
  import fidelity, publication metadata/linha fina, tables, dark appearance and draft recovery.
- Provider-paid generation is not represented by browser replays or fixture generation.

Validated totals: `pnpm gate` passed 1,909 tests and the production build; backend checks passed
391 tests. The fixture browser suite covered 77 cases (74 passed initially, then all three failed
assertions passed after correcting a platform-dependent cursor action and two legacy lauda
expectations). The connected creation/material suite passed 19 cases; its mobile keyboard
reorder case is intentionally skipped because that gesture is covered on desktop.

Before calling the fair workflow accepted, Amanda/Léo must review a real stand note, one audio
containing two events, and one educational podcast article plus carousel. Check attribution,
focus, useful structure, distinct prose and actual elapsed generation time with the configured
worker/providers. No numeric latency target was supplied, so none is invented here.

Semrush volume/difficulty validation and WordPress/Yoast publishing remain manual, as discussed;
automatic integrations were future work. Public pages must expose readable HTML/text; blocked,
paywalled or JavaScript-only pages can fail visibly and may be supplied by paste/file instead.

This integration is local. Push/PR update, merge, Preview and production deployment each follow
the exact-action approval requirement in `DEVELOPMENT_HARNESS.md`. Version 1.8.0 is unchanged;
release numbering is handled by the controlled deployment workflow after approval.
