# R2 UI preview in the shared workspace

## Scope

Entry: `/news`. R2 screens use the existing workspace sidebar, header, account, breadcrumbs and command palette, alongside Início, Produções and Modelos. The old `/prototypes/r2` URL redirects to the matching workspace destination.

The user approved publishing the R2 demonstration alongside R1 on October 15, 2026. Navigation and routes include these screens in production; `CURRENT_RELEASE` and all domain/worker gates remain R1. Every R2 destination has an R2 sidebar suffix and a demonstration badge. Images and quotes use the demonstrative catalog; production editor and delivery integration remain outside this scope.

All R2 records, people, quotes, scores, search responses, AI output and CMS permissions are illustrative. R2 state lives in a session-local React provider under the workspace layout and persists during internal navigation; reloading resets it. R2 actions do not call APIs, workers or collect credentials. The existing shared shell still reads the R1 session and production list. CMS keeps its admin restriction.

Routes: `/news`, `/news/draft`, `/images`, `/quotes`, `/archive`, `/settings/editorial-map`, `/settings/writing-guide`, `/admin/integrations`.

## Visual organization

Each R2 sidebar destination carries the `— R2` suffix through the public DS navigation badge. R1 entries retain their existing labels.

- News uses readable story cards with priority and source metadata, alongside the selected briefs and feed health.
- Quotes emphasize the full statement, author and source locator; selected quotes stay visible in a supporting panel.
- Images use landscape previews and visible credit/license information. Archive cards expose the useful excerpt and indexing action.
- Editorial settings separate coverage from scoring and voice from attribution, with live previews and weight meters.
- Hard News research presents source excerpts before selection and keeps the current brief and reference counts in a dossier panel.
- CMS configuration presents platform choices, permission review and editorial destination mapping in sequence.

All composition uses public DS components, existing spacing and responsive layouts, without product-local CSS.

## Feature coverage

| Feature | Prototype screen | Reviewable behavior |
| --- | --- | --- |
| F2.1 RSS and manual URL | `news` | Add feed with frequency; validate URL and duplicates; simulate import; pause/resume and retry a failed feed. |
| F2.2 News queue and briefs | `news` | Search, topic and score sorting, evaluate rationale, select/discard/restore a brief, open the separate Hard News example. |
| F2.3 Editorial map | `editorial-map` | Audience, geography, priorities, exclusions, scoring weights; total must equal 100; save/discard local settings. |
| F2.4 AI classification | `news` | Explicitly simulated score, rationale and editorial decision; classify pending examples. |
| F2.5 Writing guide | `writing-guide` | Voice, lead, attribution, avoided expressions and approved example; preview and local save. |
| F2.6 Web research | `hard-news` | Simulated search, primary/technical/commercial references, excerpts, source selection and prerequisite dialog. |
| F2.7 Hard News | `hard-news` | Editable outline, fixed illustrative draft, references and editable text. No AI execution. |
| F2.8 Evidence and attribution | `hard-news` | One scripted unsupported claim, source context, edit/remove resolution and human review. Editing invalidates the recorded review. This is not a general evidence checker. |
| F2.9 Images and credits | `images` | Browse/search, rights state, edit credit, block selection when rights are pending, choose image for the isolated draft. |
| F2.10 CMS | `cms` | Portal URL, simulated verification/authorization, permissions, category/author mapping, simulated synchronization and disconnect confirmation. No credentials collected. |
| F2.11 Quotes | `quotes` | Search text/author/topic, context, source locator, verification state, attributed copy and selection. Unverified example is blocked. |
| F2.12 Published archive/RAG | `archive` | Search, indexing states/retry, add URL, simulated answer with source excerpts. No index or embedding is created. |
| F2.13 Enrichment | `hard-news` | Choose quotes and internal links, insert with provenance, prevent duplicate insertions, review edited text. |

## Integration boundary

João approved integrating the R2 destinations into the existing navigation. Sidebar, active item, breadcrumbs, command palette and shared state are integrated. Before expanding existing production pages, review:

- Add “create production from selected brief” to the production entry flow/kanban.
- Add web research, outline, Hard News generation, evidence checks, and quote/internal-link suggestions to the existing article studio (F2.6–F2.8, F2.13).
- Connect image/credit selection to article images (F2.9).
- Apply the editorial map and writing guide to existing generation/worker settings (F2.3–F2.5).
- Add CMS draft delivery to the existing review/export flow (F2.10).

These production-editor/delivery changes are not included. The demonstrative Hard News flow opens from the news queue at `/news/draft` within the same workspace shell.

## Validation

- `pnpm typecheck`
- Scoped ESLint; design-system, architecture and content-density harnesses.
- `SMOKE_BASE_URL=http://localhost:3003 pnpm exec playwright test e2e/r2-prototype.spec.ts --workers=1`
- Desktop 1440 px and touch phone 390 px; route coverage, heading hierarchy, overflow, local import/research/review/enrichment, CMS authorization, image/quote safeguards and no R2 API requests or backend writes (the shared shell’s workspace reads are mocked).
