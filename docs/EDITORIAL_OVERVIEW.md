# Writer overview on the original R1 experience

The overview is based on `release-one-experience` (`2674644`), preserving its production,
transcript, article studio, approvals, carousel, model library, delivery and audit screens.
The earlier `editorial-overview` branch remains separate; its replacement workflows are not
part of this change. Work continues locally on `editorial-overview-r1`.

## Composition

- “Qual história vamos entregar hoje?” keeps the existing live, role-aware desk summary and
  the original “Nova produção” action.
- A visual card promotes `desk.continueWith`, the viewer's own next move. Its button uses the
  existing `NextStep` and `stepTargetHref`, opening the original R1 stage.
- The article's actual cover, alternative text, caption and credit come from the existing
  draft and asset queries. When no cover exists, a decorative writing photograph adds the
  approved editorial direction without pretending to be an article illustration.
- The original “Precisa de você” / “Equipe” panel retains every queue group, person, note,
  due date, status and action, including generation retry. “Ver prioridades” reaches it when
  the responsive layout places it below the main column.
- “Em andamento” keeps its existing state and actions. The featured production appears once
  in the personal view and remains visible in its team stage.
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
