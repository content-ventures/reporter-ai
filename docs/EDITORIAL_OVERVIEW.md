# Writer overview on the original R1 experience

The overview is based on `release-one-experience` (`2674644`), preserving its production,
transcript, article studio, approvals, carousel, model library, delivery and audit screens.
The earlier `editorial-overview` branch remains separate; its replacement workflows are not
part of this change. Work continues locally on `editorial-overview-r1`.

## Composition

- “Qual história vamos entregar hoje?” keeps the existing live, role-aware desk summary and
  the original “Nova produção” action.
- A compact card promotes `desk.continueWith`, the viewer's own next move. Its button uses the
  existing `NextStep` and `stepTargetHref`, opening the original R1 stage. A small image sits
  beside the title; the real production stages drive the progress indicator below it.
- The article's actual cover, alternative text, caption and credit come from the existing
  draft and asset queries. When no cover exists, a decorative writing photograph adds the
  approved editorial direction without pretending to be an article illustration.
- The original “Precisa de você” / “Equipe” panel retains every queue group, person, note,
  due date, status and action, including generation retry. “Ver prioridades” reaches it when
  the responsive layout places it below the main column.
- “Em andamento” keeps its existing state and actions. The featured production appears once
  in the personal view and remains visible in its team stage.
- “Outras produções” previews the existing team desk in four compact cards, with ownership,
  actual status, size, last update and the original next action. Stage tabs filter the existing
  groups; the preview excludes work already shown in the personal continuation/in-progress
  panels. “Ver todas” still opens the complete Produções screen.
- “Últimas movimentações” shows four actual workspace events from the existing overview
  query, with people, relative dates and links to the original productions. It follows live
  updates and role filtering already applied by the query.
- The original week line retains the 7/30-day window, URL state and last-answer behavior.
- Loading, empty, retry and example-loading states stay available. No browser reset occurs
  merely by opening the home page.

The change composes only public Content Ventures V3 components and icons. It introduces no
new workflow storage, production adapter, route, permission, release registry or local CSS.

## Visual references

The previously approved direction drew on [Ghost publishing](https://ghost.org/help/publishing-content/),
[PublishPress Planner](https://publishpress.com/planner/) and the
[21st Blog Grid](https://21st.dev/@shadcnspace/components/blog-01): a clear next action, visible
editorial priorities and photographic content. This revision applies that composition to the
existing R1 work; it does not add the earlier sample calendar or pitch workflow.

The compact revision also uses the workspace-preview and recent-activity patterns found in
the 21st catalog search (“App Dashboard Layout” and “Dashboard Activities”). It composes the
installed V3 Grid, Card, Tabs, StepperCompact and Timeline; no external component code is
installed or substituted for the project Design System.

The decorative [writing photograph](https://images.unsplash.com/photo-1455390582262-044cdead277a)
is reused from the existing local `editorial-overview` branch and served from `public/editorial/writing.jpg`.

## Verification

Run `pnpm gate` and the existing `pnpm smoke` suite. Compare the final file list against
`release-one-experience`; no original file may be deleted and changes outside the overview
must be limited to its verification and design context.

October 9 validation: `pnpm gate` passed (1,100 tests and production build), as did the
updated lint/type checks and commit gate. The overview, its continuation into the original
studio, team/personal switching and 30-day persistence passed at 1440 and 390 px.

The complete existing smoke run had 47 passes and 9 failures. An archived copy of the exact
original commit reproduced the outdated approval/retry, image-status, creation-step and
collapsed-menu test expectations. One returned-studio route timed out while loading; it
passed on retry in both widths and also passed against the original copy. Those product
screens were not changed. Full R1 acceptance still requires updating the existing smoke
scenarios to match the original experience.

The compact revision extends the overview scenario to verify real stage filtering, keyboard
navigation between tabs, opening the original material authorization screen, continuing in
the original article studio, switching the team/personal queue and preserving the 30-day URL
window. Desktop and phone screenshots are attached by that existing scenario. The unrelated
legacy smoke expectations described above remain unchanged.

Compact revision validation: `pnpm gate` passed again (1,100 tests and production build).
Eight selected route/flow checks passed at 1440 and 390 px, covering the overview, original
returned-article studio, stage filtering, continuation, range persistence and restricted
access. No original R1 file was deleted, and creation, source, studio, review, delivery, domain,
ports, adapters, runtime, state and registries have no changes against `release-one-experience`.
