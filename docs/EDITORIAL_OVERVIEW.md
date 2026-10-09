# Writer overview on the original R1 experience

The overview is based on `release-one-experience` (`2674644`), preserving its production,
transcript, article studio, approvals, carousel, model library, delivery and audit screens.
The earlier `editorial-overview` branch remains separate; its replacement workflows are not
part of this change. Work continues locally on `editorial-overview-r1`.

## Composition

- “Qual história vamos entregar hoje?” keeps the existing live, role-aware desk summary and
  the original “Nova produção” action.
- The lead promotes `desk.continueWith`, using the actual article headline and a short opening
  from its first paragraph. The image sits beside the text; the byline and existing next-step
  action sit below. The button uses `NextStep` and `stepTargetHref`, opening the original R1 stage.
- The article's actual cover (or first filled figure), alternative text, caption and credit
  come from the existing draft and asset queries. Only the lead uses a decorative writing
  photograph when no image exists; other stories never receive unrelated pictures.
- Excerpts come from the current saved text and end at a word boundary. They introduce no
  generated summary, invented copy or editing action. Local simulation output remains labelled.
- The original “Precisa de você” / “Equipe” panel retains every queue group, person, note,
  due date, status and action, including generation retry. “Ver prioridades” reaches it when
  the responsive layout places it below the main column.
- “Em andamento” keeps its existing state and actions. The featured production appears once
  in the personal view and remains visible in its team stage.
- “Histórias da redação” previews the existing team desk as four compact, equally sized cards,
  with 14 px article headlines, short openings, authors and the next action. The title and
  opening have reserved 60/40 px areas, so longer text does not move the metadata or action.
  A tooltip retains the full headline; the original studio retains the complete article.
  Images stay in the lead and delivery preview to keep the story cards the same size.
  Status, size and last update remain supporting information. Stage tabs filter the existing
  groups; the preview excludes work already shown in the personal continuation/in-progress
  panels. “Ver todas” still opens the complete Produções screen.
- “Na entrega” previews an existing delivery-stage story, including its real image, headline
  and opening. “Ler artigo” opens the original delivery article view; the original delivery
  action remains beside it. This story takes visual priority over the task panel in the aside.
- “Últimas movimentações”, under “Ver movimentações recentes”, shows four actual workspace events from the existing overview
  query, with people, relative dates and links to the original productions. It follows live
  updates and role filtering already applied by the query.
- The original week line retains the 7/30-day window, URL state and last-answer behavior.
- Loading, empty, retry and example-loading states stay available. No browser reset occurs
  merely by opening the home page.

The overview composes only public Content Ventures V3 components and icons, including Card
and ScrollArea for equal preview areas. It adds no local CSS or replacement R1 screen.
The separately requested “Escrever do zero” entry adds the direct-writing flow documented
in `docs/DIRECT_WRITING.md`; the transcript creation journey remains available unchanged.

## Visual references

The previously approved direction drew on [Ghost publishing](https://ghost.org/help/publishing-content/),
[PublishPress Planner](https://publishpress.com/planner/) and the
[21st Blog Grid](https://21st.dev/@shadcnspace/components/blog-01): a clear next action, visible
editorial priorities and photographic content. This revision applies that composition to the
existing R1 work; it does not add the earlier sample calendar or pitch workflow.

The selected editorial direction uses the image/text composition in
[21st Split Image Blog List](https://21st.dev/@ziegfiroyt/components/blog25) and the headline
hierarchy in Blog Grid. It composes installed V3 Grid, Prose, EditableTitle, MediaFrame, Tabs,
Accordion and Timeline; no external component code replaces the project Design System.

The decorative [writing photograph](https://images.unsplash.com/photo-1455390582262-044cdead277a)
is reused from the existing local `editorial-overview` branch and served from `public/editorial/writing.jpg`.

## Verification

Run `pnpm gate` and the existing `pnpm smoke` suite. Compare the final file list against
`release-one-experience`; no original file may be deleted. Changes outside the overview are
limited to verification/design context and the explicitly requested direct-writing addition.

October 9 validation: `pnpm gate` passed (1,100 tests and production build), as did the
updated lint/type checks and commit gate. The overview, its continuation into the original
studio, team/personal switching and 30-day persistence passed at 1440 and 390 px.

The complete existing smoke run had 47 passes and 9 failures. An archived copy of the exact
original commit reproduced the outdated approval/retry, image-status, creation-step and
collapsed-menu test expectations. One returned-studio route timed out while loading; it
passed on retry in both widths and also passed against the original copy. Those product
screens were not changed. Full R1 acceptance still requires updating the existing smoke
scenarios to match the original experience.

The overview scenario verifies real stage filtering, keyboard
navigation between tabs, opening the original material authorization screen, continuing in
the original article studio, switching the team/personal queue and preserving the 30-day URL
window. It also checks real article text and cover, the original delivery article view and
role filtering of story previews. Desktop and phone screenshots are attached by that existing scenario. The unrelated
legacy smoke expectations described above remain unchanged.

Earlier compact revision validation: `pnpm gate` passed again (1,100 tests and production build).
Eight selected route/flow checks passed at 1440 and 390 px, covering the overview, original
returned-article studio, stage filtering, continuation, range persistence and restricted
access. No original R1 file was deleted, and creation, source, studio, review, delivery, domain,
ports, adapters, runtime, state and registries have no changes against `release-one-experience`.
This historical statement predates the separately requested direct-writing addition.

Final editorial/direct-writing validation: `pnpm gate` passed with 1,106 tests and the
production build. Ten selected route/flow checks passed at 1440 and 390 px. They also assert
equal compact card heights when an article has no text, then cover writing a title and body,
autosave, browser reload and continuation into the same article. No original file was deleted.
