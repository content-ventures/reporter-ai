# R2 writing action plan

The writing workstream turns **Conteúdo** into an article ready for a journalist's approval: title, dek, structured body, source references, and separate reporting issues. Content may arrive as recordings, transcripts, text, documents, URLs, or mixed material without a mandatory user briefing format. Internal organization is the application's responsibility; support for individual file formats remains an intake capability, not a promise to parse every file.

The first deliverable is the filled [Seafood editorial map and writing guide](SEAFOOD_EDITORIAL_STANDARD.md). This plan consolidates the scope and execution decisions agreed on October 21, 2026. Its status is **editorial specification, editable settings and managed orchestration implemented locally; newsroom evaluation pending**. Proposed Seafood values and pilot targets still need newsroom validation. The implementation is local and has not changed deployed settings or model configuration. See [managed writing orchestration](WRITING_ORCHESTRATION.md) for the implemented controls, run inspection and operational limits.

The [closeout action plan](#closeout-action-plan) defines the remaining work for this delivery. The later sections preserve the architecture, editorial rationale and broader evaluation protocol; they do not add prerequisites to closeout unless identified below.

## Scope and dependencies

| Area | Writing workstream responsibility | Integration boundary |
| --- | --- | --- |
| Editorial map, F2.3 | Use and specify the shared map's effect on relevance, angle, and explanations | Notícias and writing consume one versioned map; no competing schema or settings copy. |
| Writing guide, F2.5 | Own the outlet's writing and composition policies, curated examples, and versioning | Existing UI and domain fields are reused; extend only for explicit missing responsibilities. |
| Generation, F2.7 | Content preparation, editorial decision, whole-article drafting, prompt composition, model selection | Accepted content is sufficient to enter. A news item ID is not mandatory. |
| Evidence and attribution, F2.8 | Source fidelity, unsupported statements, attribution, material omissions, review and correction | Reuse existing evidence and citation capabilities; distinguish fidelity from external veracity checks. |
| Research, F2.6 | Specify and consume source records with excerpts, dates, origin, and locators | Web retrieval implementation is a separate capability. Request missing reporting when needed. |
| Images, F2.9 | Preserve images, captions, alt, credits, and unresolved rights status in article composition | Asset acquisition and library implementation belong to their own feature. |
| CMS, F2.10 | Supply the approved document and verify its semantic handoff contract | Connection and publishing implementation belong to the CMS feature. Verify appearance there when available. |
| Citations, RAG and enrichment, F2.11–F2.13 | Consume relevant, attributed, dated records and accepted enrichment | The first reliable article must not depend on a completed archive index. Retrieval is not proof of current truth. |
| News intake and radar, F2.1, F2.2, F2.4 | No implementation in this workstream | RSS, manual news import, queues, classification, and story selection remain in the other workstream. |

Direct writing remains available. Human authors do not need a news record or a fabricated transcript. For AI assistance, pasted text becomes identified content; the model cannot manufacture evidence to compensate for missing input. Recordings reuse the existing transcription path and retain audio locators where available.

## Delivery sequence

| Order | Deliverable | Acceptance | Status |
| --- | --- | --- | --- |
| 1 | Filled map and guide matrices, ownership, genre boundaries, reference annotations | Each policy has an owner, proposed value, writing effect, and limit; real references replace demo assumptions | Specification delivered in `SEAFOOD_EDITORIAL_STANDARD.md`; newsroom calibration pending |
| 2 | Versioned settings contract and deterministic prompt composition | Editable frontend, durable workspace settings, version snapshots and stable prompt composition | Implemented locally, with actual composed requests and immutable snapshots in the execution inspector; per-rule composition manifest remains pending |
| 3 | Content preparation, editorial decision, and whole-article generation | Original evidence survives preparation; sparse or conflicting material has an explicit outcome | Implemented locally as an opt-in flow; every stage receives original content |
| 4 | Independent review and bounded correction | Findings identify article spans, evidence, severity, and required action; substantive changes are rechecked | Implemented locally; configurable models and instructions, zero/one correction, complete run inspection |
| 5 | Consistent article presentation and handoff | Dek and semantic blocks survive editing, review, approval, export, and the supported destination | Semantic article conversion and dek display implemented locally; complete connected acceptance remains in C3 |
| 6 | Controlled comparison and fresh-case pilot | Blind newsroom evaluation, repeatability, and editing effort meet the agreed release criteria | Same-model MSD comparison recorded; six-case development evaluation remains in C4; reserved-case parity evaluation follows separately |

The existing roadmap allocates 4 hours to the guide, 12 to generation, and 8 to evidence and attribution. These are inherited estimates, not confirmation that expanded composition, calibration, and review work fits them. Re-estimate implementation after the contracts are detailed. Do not assign new dates or expand the news workstream's scope by implication.

## Closeout action plan

**Finish line:** a journalist can supply content, generate an article, inspect its sources and review findings, edit it, approve it and export it through the frontend. Administrators can change the map, guide, stage models and instructions there. The chosen configuration must also pass the six-content newsroom check below. Release is finished only when the validated version and configuration are available in the intended environment.

The core implementation and local tests already pass. The remaining work is the five steps below, in this order. Engineering owns execution and fixes. João supplies the final editorial judgment, directly or through a designated journalist, and authorizes the repository's remote delivery actions. No calendar commitment is made before confirming the acceptance environment and reviewers.

### C1 Fix the known remaining problems

- Make the suggested guide and review criteria favor a concise dek with a clear central complement, a natural closing and temporal consistency throughout retrospective reporting. Do not introduce a universal character quota.
- Correct the false geography alert for supported equivalence such as Minas Gerais/MG without allowing an unsupported state or location.
- Keep every change editable or inspectable in the existing frontend. Preserve the original MSD output as comparison evidence.

Perform one bounded calibration round with the same source and models. Check the known problems and all original essential meanings. Fix a demonstrated factual or software regression; record ordinary remaining copy preferences for the journalist instead of starting an unlimited polishing loop.

**Finished when:** the known refinements are addressed in the guide/review, the grounded-abbreviation regression passes, and the comparison records preserved meaning and any residual editorial preference.

### C2 Add observable Tavily context and prove the real frontend

Use the direct Tavily API after the existing planning call. The plan proposes bounded queries tied to original evidence; no extra model call is required. Administrators edit search instructions, limits, exclusions and failure behavior in the frontend. Save queries, returned excerpts, URLs, publication/retrieval dates, provider request IDs and reported credits in the run. Reference articles in the writing guide are excluded. External context never silently supplies an interview identity/date or changes the original essential facts. Persist external references with the article and exclude previous research from the next run's original content.

Prepare the exact local acceptance commits and production build under the repository harness, preserving unrelated work. Use an isolated acceptance workspace with a real persistent backend, worker and provider calls.

Through the frontend, save the chosen map, guide, stage models and prompts; reload; generate from real content; close and reopen the production and execution. Confirm that the article, source references, source dates, effective prompts/models, token usage when supplied, findings and correction history persist. Change a setting and confirm that the previous execution retains its original configuration. Check one failure/retry or cancellation path. Fix defects found in this path and rerun the affected checks.

Use the true execution date and keep unknown source dates unknown. A saved source is not evidence that every statement in it is independently true.

**Finished when:** the real workflow works after reopening the application and all management and inspection can be done from the frontend. The earlier replay with mocked endpoints is supporting UI evidence, not completion of this step.

### C3 Close formatting and export

Take the same persisted article through a manual edit, review, approval and every supported export path. Check title, dek, paragraph order, headings, quotations and deliberate emphasis on desktop and phone. Check applicable links, lists, figures, captions and credits using relevant content. Verify that the approved version is exported, with no duplicated title, missing dek, changed quotation or internal reporting note in the public article.

Fix any mismatch and repeat the affected path. Record the presentation limits of plain text explicitly; essential content must survive. CMS connection remains in its own workstream.

**Finished when:** the approved article retains its content and intended structure from the editor to the supported exported file.

### C4 Generate and evaluate six distinct articles

The provenance audit found four supported source contents: MSD, the Seafood Show Latin America announcement, a medium interview excerpt and a long retail podcast. Hecke, Aquishow and Apex fixtures are hand-written material overlapping published articles, not independent interviews. The development batch uses the four supported sources plus Hecke and Apex, with this distinction recorded. These six executions cannot establish six independent newsroom holdouts. Inspect each complete source before using it; raw/curated variants count as one content. If a candidate is incomplete or unsuitable, replace it with another verified content and name the replacement in the comparison.

Keep GPT-6 Astra for planning/review and Claude Opus 5.5 for writing/correction, with the current parameters. Before generating, record the facts, qualifications and quotations that must survive. Preserve every initial output, correction and failure. Compare with the previous flow and human references where the same evidence is available; record extra human reporting rather than attributing it to better model writing.

Deliver one review packet containing the six inputs, generated articles, comparisons, factual checks and proposed corrections. João or the designated journalist judges anonymized versions and records the edits and active editing time. Inputs that cannot sustain an article must produce an explicit reporting outcome and be excluded from the article-quality count; obtain a replacement for the six-article set.

**Finished when:** all six articles have a recorded human judgment and can be approved with light editing, with no accepted critical distortion, invented quotation or loss of essential meaning. A failed case receives a concrete fix and recheck; a shared prompt change also requires rechecking the cases it can affect.

### C5 Deliver the validated version and configuration

Prepare the final review package: cohesive commits, exact version/configuration, the six-case results, connected-flow and export evidence, and known limits. Run the required gate, backend checks and smoke on the exact acceptance build. Keep private source material and credentials out of repository history.

For the current request, stop with the validated package ready for the deployment decision. Do not push, open a PR, merge or deploy. Those later steps require the specific remote-action approvals in `DEVELOPMENT_HARNESS.md`. Record shared configuration activation separately, retain the prior revision for recovery, and verify the deployed version, worker readiness and intended frontend workflow.

**Current handoff finished when:** the local delivery commits, acceptance build, validation evidence, configuration activation instructions and remaining editorial decisions are concrete and reviewable. Deployment remains a separate authorized action; do not describe a local build as a deployed release.

### What requires João

Engineering prepares the environment, fixes, tests and six-article comparison. João needs to provide the editorial verdict or designate the journalist who will give it. If source information essential to an article cannot be verified from the supplied material, engineering lists the exact missing fact and its source passage for confirmation. Remote delivery approvals occur only when the concrete package is ready, following the harness.

### Scope of this finish line

This delivery includes the five steps above. RSS/news queues, CMS integration, RAG, new providers and model competitions remain separate workstreams. The later twelve-case reserved evaluation is for a broader quality claim and is not an extra hidden requirement for this delivery. Detailed per-rule prompt provenance and legacy-flow cleanup remain follow-ups unless a concrete acceptance failure makes them necessary.

**Current status:** closeout implementation and validation are in progress. Tavily was explicitly added to the writing workstream. Shared configuration activation, independent holdout expansion and the human editorial verdict remain distinct from technical deployment readiness. The final validation record below will report actual outcomes, including failures.

## Editorial improvement round — implemented locally, evaluation in progress

This round follows the comparison of the 18 supplied Seafood Brasil references with the final MSD pilot. Its software changes are **implemented locally; shared configuration activation and broader newsroom evaluation remain pending**. It improves the existing orchestration rather than introducing a new writing pipeline. The 262-word MSD output at `.reporter-local/pilots/2026-10-21-editorial/polished/article.md` remains the frozen comparison baseline. Its source, prompts, policy and reviews are unchanged. The new evidence package is `.reporter-local/pilots/2026-10-21-refinement/`; retained intermediate results are part of the evaluation, not silently replaced successes.

The observed problems are an apparently current price assessment in the dek despite an unknown interview date, repeated optimistic statements, repeated attribution markers, oral imagery carried into narration, and an investment sentence detached from the price explanation. The title's product focus and the short sanitation-cost section are editorial choices to assess, not automatic errors. Existing policy already preserves facts and literal quotations; the next round must retain those protections.

The comparison does not justify quotas for length, headings or quotations. [Guabi](https://www.seafoodbrasil.com.br/aquicultura/guabi-foca-em-manejo-nutricional-preventivo-na-aquishow-2026/) and [Masterboi](https://www.seafoodbrasil.com.br/varejo/masterboi-reforca-presenca-no-pescado-com-marca-propria-na-apas-show/) show that short pieces without body subheadings fit this reference set. [Riberalves](https://www.seafoodbrasil.com.br/varejo/riberalves-foca-em-acessibilidade-e-praticidade-na-apas-2026/) and [Hecke](https://www.seafoodbrasil.com.br/varejo/hecke-estreou-no-mercado-de-pescado-com-merluza-na-apas-show/) provide useful examples of linking a commercial problem, an action and operational details. Such details must come from the current content or additional reporting, never from the example article.

### Ordered deliverables

| Order / priority | Deliverable | Existing owner and frontend | Completion evidence |
| --- | --- | --- | --- |
| 1 / P0 | Carry source dates into planning, writing, review and correction, separately from the execution date | Existing content date field; source provenance in the execution inspector; factual review criterion | The same old interview generated on a later date cannot silently become a current market assessment. Missing dates remain unknown. |
| 2 / P1 | Calibrate angle, narration, attribution and semantic repetition | Editorial map stays shared; writing guide and editable stage instructions | The plan identifies a main development and related secondary points; the article connects those points without mechanically repeating the speaker or reproducing oral filler. |
| 3 / P1 | Make review distinguish material defects from optional refinements | Existing five editorial axes, severity, findings and correction audit | An unresolved substantive issue blocks readiness; an optional suggestion remains inspectable without becoming a blocker after another correction. |
| 4 / P1 | Surface useful reporting gaps with their consequence | Existing plan issues and review findings, outside the publishable body | Missing information identifies what to confirm, why it matters and the relevant source passage when one exists. Central and optional gaps have different outcomes. |
| 5 / P1 | Verify management and preservation end to end | Existing settings, prompt preview, run inspector and article review | Saved revisions, effective prompts, dates, decisions and changes can be inspected from the frontend on desktop and phone. |
| 6 / P1 | Repeat the MSD comparison and run broader development cases | Same direct providers and frozen model parameters first | All outputs and interventions are retained; human reading confirms preservation and the intended editorial improvement before a later model comparison. |

Deliverable 1 comes first. Guide calibration and review changes can then proceed together; UI and persistence verification accompany each change rather than being deferred to the final test. No new calendar deadline or engineering-hours commitment is implied by this order.

### 1. Temporal context and provenance

`Source.recordedOn` stores the optional source date. It is editable at creation and now also in **Contexto e falantes** for existing materials. The worker forwards it per source in `brief.temporalContext`, separately from the execution day. Missing dates stay unknown; no new required date or structured user briefing is imposed. Editing a date validates access and the previously seen date, preserves transcript versions, records an activity with old/new values, and changes the context hash for future generation without rewriting historical traces.

- Pass source metadata keyed to the original source references once in the composed context. Keep recording date, an explicitly supplied event date and execution date distinct. Do not use upload time, source-version creation time or execution time as the date of a declaration. Do not invent a publication date.
- Preserve metadata per source when several materials are combined. A date mentioned in a paragraph is evidence to interpret, not permission to apply it to every source.
- Capture the effective temporal context in the run snapshot and prompt/cache identity. Source metadata changes already participate in `editorialContextHash`; verify that behavior through queued execution, retries and the new composed input.
- Expand the factual criterion to compare the temporal scope of title, dek and body with the source. A present-tense headline is not automatically wrong; unsupported present relevance is the defect.
- With an unknown recording date, a supported historical/event account may proceed with conservative wording. If a claim of current market conditions is essential to the selected angle and cannot be supported, return `needs_reporting`. Do not stop every undated input indiscriminately.
- Show supplied dates and their origin readably in the existing run inspector. Historical runs lacking this metadata must say it was not recorded, rather than displaying the run date as the interview date.

### 2. Policy and task changes

Keep the editorial map's current audience and scope. Use it to explain relevance and to distinguish broad event coverage from a narrowly focused market or technical article. The comparison does not support replacing the map or creating a second writing-specific copy.

| Editable location | Proposed instruction or behavior | Acceptance boundary |
| --- | --- | --- |
| Guide: attribution | "Mantenha clara a autoria ao longo do parágrafo. Retome a fonte quando houver mudança, ambiguidade ou nova afirmação que precise de atribuição; evite reapresentá-la em cada frase." | No numeric limit on attribution markers; removing repetition cannot turn an opinion into the outlet's statement or confuse speakers. |
| Guide: paragraphs | "Conecte informação, explicação e consequência quando pertencem ao mesmo assunto. Integre frases isoladas quando isso melhora a compreensão. Elimine frases que apenas anunciam o que a seguinte já informa." | Judge information and flow, not equal paragraph sizes or a mandatory maximum. |
| Guide: voice / narration | "No discurso indireto, transforme a oralidade em explicação clara, preservando autoria, causalidade, intensidade e ressalvas. Dentro das aspas, preserve o texto original." | Technical terminology and quotation wording are not rewritten by plausibility. |
| Guide: title, dek and lead | "Escolha o desenvolvimento principal e organize os complementos em torno dele. Título, linha fina e abertura devem orientar a mesma leitura, sem exigir que todos os temas apareçam no título." | A company/event piece may cover product and market together. Do not impose a single-topic formula on every genre. |
| Guide: headings | Keep divisions for meaningful subject changes, considering the actual format and approved production choices | Inspect the interaction with `Brief.sections` and the stand format's heading instruction before changing behavior; do not weaken specialized formats globally. |
| Plan task: `angle`, `outline`, facts and issues | Record the central development, its relevance, the ordered secondary points and any gap that prevents a useful explanation | Reuse the existing plan fields; no new mandatory model call or duplicate outlet policy in task text. |
| Write / correct tasks | Apply the saved guide to the whole article and preserve the fixed essentials through regrouping, shorter narration and quote selection | A fact may move across blocks; a lower word count is not a target or evidence of better writing. |

Use small, annotated examples of the intended editing operation when needed. Prefer the project's own before/after passages for repetition and attribution. External examples teach a choice and do not supply facts, quotations or a universal article template. Replace overlapping instructions rather than continually appending them to prompts.

### 3. Review and bounded correction

Reuse the five existing axes: temporal support belongs under `uncertainty`; alignment of title/dek/body under `hierarchy`; semantic repetition and paragraph continuity under `economy`; oral narration and awkward expression under `language`. Quotation usefulness remains under `quotes`. No sixth axis or mandatory stylistic polishing worker is needed for this round.

A substantive finding must name the passage, the effect on meaning or reading, the supporting evidence or policy, and a concrete correction. An alternative subheading or equally valid ordering is not enough to force a rewrite. `ready_for_human` remains a handoff to a journalist, not a declaration of publication readiness or parity with human reporting.

The post-correction validator now permits the same optional suggestions as the first review. It continues auditing every previous ID, while blocking readiness for unresolved findings whose **original** severity was major or critical. An unresolved minor suggestion remains visible with its explanation. A later model cannot downgrade an earlier substantive finding to escape the check. Missing essentials, invented quotations and invalid evidence retain their existing blocking behavior. A top-level `revise` containing only minor suggestions is normalized only when the complete audit is otherwise ready; the original verdict remains observable.

Preserve the normal three-call path and the bounded five-call path with one correction. If substantive problems remain, retain the output and findings for the journalist instead of continuing an unbounded automatic loop.

### 4. Reporting gaps and frontend behavior

Reuse the current plan issues and localized review findings before extending their schemas. A useful gap states the missing information, the affected claim or topic, the source passage when available, and the consequence for the selected angle. The user can supply a correction through the existing content or confirmed-metadata flow and generate a new version; the original run stays unchanged.

For MSD, examples are the interview date, confirmed role, adequate technical wording for the vaccine and the actual conclusion of the sanitation-cost comparison. The last item can be an optional opportunity to enrich a supported event account; it becomes blocking only if the article promises to explain that missing result. Do not invent a role, disease indication, efficacy, numerical result or causal conclusion to make the article sound complete.

Keep administration in the current surfaces:

- **Editorial map:** audience, coverage and relevance; no duplicate configuration.
- **Writing guide:** narration, attribution, paragraphs, title/dek/lead and divisions.
- **Prompts → Writing:** task instructions, review criteria and stage models/parameters.
- **Content:** supplied source dates and confirmed metadata.
- **Executions:** frozen inputs, temporal provenance, angle, source-linked findings, optional suggestions, before/after correction and usage.

Existing custom settings are not silently replaced by new defaults. A deliberate save creates a new version; concurrent changes still require conflict handling. Historical executions show the fields actually captured, without fabricated checks. Preserve source evidence links after paragraphs merge or move. Verify final title, dek and body in the same reading surface before comparing typography; the CMS theme and promotional page modules are not writing-prompt requirements.

### 5. Acceptance and comparison protocol for this round

| Scenario | Required observation |
| --- | --- |
| Old dated interview, later execution date | All four stages see the source date; no unsupported assertion that its assessment is still current. |
| Undated or conflicting material | No guessed date. A supportable historical account can proceed; a central unsupported current claim produces an actionable reporting outcome. |
| Several sources with different dates or speakers | Temporal scope and attribution remain attached to the correct source after condensation. |
| Minor suggestions only | Three-call path may finish for human review, retaining the suggestions. |
| Major issue corrected, minor suggestion retained | Five-call path may finish with the minor item visible; the previous major issue is explicitly resolved. |
| Previous major issue unresolved or relabeled | Readiness remains blocked using its original severity. |
| Paragraph merge or quote reduction | Long-term purpose, causes, conditions, forecast horizons and uncertainty remain, with valid source links. |
| Historical runs and settings | Missing metadata is explicit, custom values survive, and old records remain readable. |
| Desktop and phone | The actual effective settings and recorded findings are usable without relying on JSON inspection alone. |

For the first editorial comparison, keep Claude Opus 5.5 for writing/correction and GPT-6 Astra for planning/review with the baseline parameters. This tests the proposed process changes without simultaneously changing model selection. Models remain configurable in the frontend. A later experiment may compare providers one stage at a time on the same inputs and criteria.

1. Freeze the current MSD source, metadata, complete output and configuration. Record a human-checked list of information that must survive; compare meanings and evidence, not the number of model-selected fact IDs.
2. Re-review the unchanged baseline under the candidate criteria. Record whether it identifies the temporal ambiguity and redundant forecast phrasing without being told the known failures. Do not require the reviewer to reject a merely optional heading choice.
3. Generate the candidate from the same source. Keep every initial draft, correction, rejection, prompt, source/policy snapshot, provider response and usage record. No manual editing before measuring the raw candidate; subsequent human edits are recorded separately.
4. Test broader development inputs. Available files include `stand-hecke.json` and `note-ssla-abertura.json` in the rehearsal cases directory. Verify their provenance and prior use before selection; they are development candidates, not assumed untouched holdouts. Retain the existing Real Fish/C.Vale regression goals when their complete input bundles are available.
5. Have a journalist compare anonymized, order-randomized versions in the same presentation. Record factual repairs, recovered information, substantive rewrites, formatting changes and active editing time separately from additional reporting. An internal model review is diagnostic and does not substitute for that newsroom assessment.
6. Freeze the candidate before the reserved-case evaluation already defined below. If the small development batch improves, that supports further evaluation; it does not establish broad editorial parity.

Round exit criteria: no regression in factual preservation, attribution or quotation integrity; the temporal issue is resolved or explicitly routed to reporting; repeated forecast padding is removed without losing the two horizons; optional choices do not cause false blocks; frontend settings and execution history reflect the actual behavior; software tests and the production build pass. Require a recorded newsroom comparison before claiming that the new output needs only light editing. Do not set a target word count or present lower token usage as an editorial-quality score.

### Implementation work packages

| Package | Primary implementation surfaces | Verification |
| --- | --- | --- |
| Source temporal context | `src/server/editorial-worker.ts`, composition in `src/domain/writing-orchestration.ts`, existing source form and run inspector | Source/queue/snapshot/cache tests; known/unknown/conflicting date scenarios; old-run rendering |
| Policy calibration and task defaults | `docs/SEAFOOD_EDITORIAL_STANDARD.md`, existing guide settings, editable task/criteria defaults | Saved customization and revision checks; exact composed input inspection; real MSD comparison |
| Review severity and preservation | `src/server/writing-orchestration.ts`, its domain contract and focused backend tests | Original-severity enforcement; minor-only and mixed-severity paths; essential-fact and quotation regressions |
| Frontend management and evidence | `src/features/pipeline/writing-orchestration-editor.tsx`, `writing-run-details.tsx`, existing editorial settings | Desktop/mobile scenarios, readable provenance and optional findings, no false historical values |
| Editorial evaluation | Existing local pilot tooling and recorded case bundles | Unchanged-baseline diagnostic, same-model candidate, broader development cases and human editing record |

The temporal, policy, review and frontend packages are implemented locally. The guide offers an explicit before/after preview and an editable draft rather than overwriting custom settings on load; task defaults are also opt-in for existing saved configurations. Real MSD generation and unchanged-baseline review use the frozen models and parameters. Broader development cases, reserved-case evaluation and measured journalist editing remain outstanding and are not implied by a successful software test or model verdict. Follow the recorded pilot in `WRITING_ORCHESTRATION.md` for results and limits. No shared policy was activated and no application was deployed by this local work.

## Prompt composition

The application assembles each call from factual invariants, the worker's task contract, the relevant map and guide policies, production decisions, and the required content. No extra model writes a new system prompt for each run.

| Stage | Map contribution | Guide contribution | Evidence and production input |
| --- | --- | --- | --- |
| Prepare and plan | Audience, scope, topics, priorities, source preferences | Genre boundaries and attribution requirements | Original content, confirmed metadata, conflicts, requested angle or size if supplied |
| Write | Audience and relevance behind the chosen angle | Voice, title, dek, lead, attribution, terminology, composition, selected examples | Plan, essential claims, original supporting passages, accessible full content |
| Review | Relevance and coverage boundaries | The exact guide version used to draft; all applicable rule IDs | Full article, original content, factual notebook, plan; no author-model identity or self-evaluation |
| Correct | Same map snapshot | Same guide snapshot | Exact article revision and evidence-backed findings; no new unsupported scope |

Map or guide changes affect later runs. A run captures the map, guide, content versions, accepted production adjustments, example snapshots, task templates, compiler version, model ID, parameters, and resulting prompt hash. Cache reuse must include these dependencies. Deterministic composition does not imply identical model outputs.

The implemented inspector retains the complete composed prompts and policy snapshots. A per-rule composition manifest and automatic reporting of editorial-rule contradictions remain follow-ups; they are not implied by visibility of the full prompt. Changing length or angle is an explicit production decision. No instruction authorizes fabrication. Content passages and examples are clearly separated from instructions, and retrieval results are treated as evidence rather than execution commands. Future rule selection must preserve these boundaries and avoid repeated or conflicting paragraphs across prompts.

The shared domain map and guide are in `src/domain/hard-news.ts`. The frontend edits them at `/settings/editorial-map` and `/settings/writing-guide`. Connected workspaces save through the existing pipeline settings port with optimistic concurrency and server-owned authorship and version numbers. The map and guide live in `PipelineDefinition.editorial`, so queued runs retain their immutable settings snapshot and existing database persistence needs no separate migration. Prompt configuration and editorial settings share the pipeline revision lock; an intervening edit requires a deliberate reload instead of silently overwriting it.

The guide supports voice, title, dek, lead, attribution, composition, rules, terminology, and reference title/URL/observations. Recent history is projected from the last 20 pipeline revisions; it is not a complete permanent change archive. Empty connected workspaces start without demonstration values. Local simulation remains explicitly labeled and isolated. The Notícias radar still uses its demonstration store until that workstream connects to this shared policy; saving the map does not claim to reclassify news.

`editorialSystemPrompt` deterministically adds the saved policy to the existing facts, outline, quotes, introduction, section, complete article, and assistant stages. The resulting request participates in the existing cache hash. A reference URL is stored with its editorial observation, not fetched or treated as evidence. Saved style preferences supersede conflicting worker style instructions, while factual safeguards and output contracts remain mandatory. The optional managed orchestration now supplies the three-call path and bounded correction with `composeWritingPrompt`. It reuses semantic article blocks and displays the dek through review and delivery; evaluation of every composition preference and CMS appearance remains pending.

## Initial stage contracts

These are proposed internal contracts. They organize arbitrary user content without requiring the user to supply structured JSON.

| Contract | Required output | Integrity condition |
| --- | --- | --- |
| Content record | ID, kind, original material or reference, available author/speaker, event and publication dates separately, locators, derived text, ambiguities | Preserve original and derived versions; missing metadata stays unknown. Recording, transcript, and article are distinct sources. |
| Factual notebook | Claims with IDs, source references, qualifiers, time scope and type; original quotations with speakers and locators; conflicts and gaps | Types distinguish source-reported facts, opinions, plans and forecasts. Evidence proves what a source says, not necessarily that its claim is true. |
| Editorial plan | Genre, central development, evidence-backed angle, reader relevance, indispensable details, ordered secondary points, optional headings, length guidance, unresolved issues | `ready` or `needs_reporting`. A central conflict may stop drafting; a dispensable detail may be omitted with the issue retained. |
| Article | Title, dek, ordered semantic blocks, source/claim references, unresolved issues outside publishable text | Whole-article output. References are internal metadata; no placeholder attribution or production commentary in the body. |
| Review | `ready_for_human`, `revise`, or `needs_reporting`; localized issues with severity, category, evidence and requested fix | Categories cover fidelity, attribution, omission, angle, progression, promotional wording, and composition. No vague fluency scores as the sole reason for rewriting. |
| Correction | Revised article, addressed issue IDs, changed block IDs, and unresolved findings | Preserve unaffected meaning and all critical qualifiers. Recheck changed passages and article-wide consistency. |

Keep the original content accessible to both writer and reviewer, so a preparation omission can be caught. For material beyond the model's capacity, preserve indexed source passages and coverage records; use retrieval back to originals rather than repeated summary-only reduction. A source can contain an instruction or a persuasive claim without becoming an authority over the writing process.

The initial normal path uses three model calls: prepare and plan, write, review. A substantive correction adds a correction call and a recheck, up to five calls on that path. Long-content processing or additional reporting is a separately recorded branch. Limit automatic correction to one cycle initially; persistent material issues go to a journalist. Do not silently cut sentences to satisfy size or factual validation at the expense of coherence.

## Examples of composed instructions

These shortened Portuguese examples illustrate the division of responsibility. They are specification examples, not active prompts or generated articles. Production payloads also contain output schemas, selected rule IDs, source records, and the version manifest.

**Prepare and plan**

> Organize o conteúdo recebido sem presumir que ele seja uma notícia ou uma entrevista já identificada. Separe fatos relatados, avaliações, intenções, previsões, falas e dúvidas, ligando cada item ao trecho de origem. Para profissionais da cadeia do pescado, escolha o desenvolvimento mais relevante e liste os detalhes indispensáveis para compreendê-lo. Priorize implicações documentadas de produto, mercado ou operação quando fizerem parte da notícia. Não transforme participação em feira, pioneirismo alegado ou uma previsão otimista no ângulo por obrigação. Entregue a pauta e as pendências; se faltar sustentação central, indique o que precisa ser apurado.

**Write**

> Redija título, linha fina e corpo como uma unidade, usando a pauta e as fontes originais. Escreva de forma jornalística, direta, informada e acessível. O título apresenta o movimento principal; a linha fina acrescenta informação; a abertura entrega cedo o acontecimento e seu contexto. Preserve os detalhes indispensáveis e atribua avaliações e promessas. Use parágrafos e intertítulos conforme a progressão do assunto, sem quantidade fixa. As aspas precisam de suporte na fonte e não recebem negrito automático. Registre dúvidas fora do texto publicável. Encerre com a última informação relevante, sem frase obrigatória.

**Review**

> Compare título, linha fina e corpo com o conteúdo original, a pauta e as regras editoriais desta execução. Verifique suporte factual, autoria das falas, qualificadores, temporalidade, informações essenciais omitidas e coerência do ângulo. Confira também progressão, repetição, linguagem promocional e composição. Para cada problema, indique trecho afetado, gravidade, evidência, regra aplicável e correção necessária. Uma preferência estilística sem consequência concreta não justifica reescrever a matéria. Entregue os achados e a decisão, sem substituir o artigo por iniciativa própria.

The matrix owns the editorial wording behind these examples. Implementation projects those rules into the task templates; it must not preserve the examples as a second editable set of Seafood policies.

## Document composition and migration

The article domain already supports paragraphs, H2/H3, quotations, lists, and figures. The new generation contract should use these semantic blocks when appropriate. Presentation belongs to the existing Design System in Reporter IA and to the destination's theme in the CMS; the model does not invent typography or CSS.

| Confirmed implementation point | Planned change | Acceptance evidence |
| --- | --- | --- |
| `citation-library.ts` applies bold to quotations of four or more words | Use the guide's selective emphasis policy; preserve deliberate manual edits | Ordinary generated quotations stay readable as part of the body; chosen marks survive export |
| `article-reading.tsx` and `article-final.tsx` omit the dek from their headers | Render title, dek, and body consistently | The approved dek appears in review, delivery, and the supported export |
| `editorial-worker.ts` assembles generated paragraphs and fixed section headings | Preserve typed blocks and optional divisions in the new path | A brief needs no headings; a genuine list is exported as a list |
| Event formats force sequential writing in `formatPipelineDefinition` | Introduce and compare the new whole-article path without silently rewriting legacy articles | Scoped reference cases preserve evidence and improve whole-article progression |
| HTML, Markdown, clipboard and reading surfaces have different capabilities | Define one content contract with explicit channel limitations and destination field mapping | No title duplication, missing dek, hidden service box, or unreported plain-text fallback |

Titles and deks map to the destination's fields, rather than being blindly duplicated in the body. Figures preserve caption, credit and alt separately. Compare the actual destination draft on desktop and phone when its adapter is available. Before that point, validate the internal document and export semantics without claiming CMS parity.

Manual writing, existing drafts, approved immutable versions, and specialized formats remain valid during migration. Existing citation fidelity and external fact-checking features are reused where applicable; they are not replaced by a stylistic reviewer. A schema-valid response or a name/number occurrence check does not establish that the claim is true.

## Provider configuration

The user reports OpenAI, Claude and Gemini keys in `.env.local`. These are the initial providers for comparison through direct vendor APIs. Account access, supported model IDs and adapter readiness are separate validation steps. Do not copy key values into fixtures, prompts, logs or documentation. Grok is an optional later candidate and is not a prerequisite for this pilot.

Start comparisons with one strong model across the same roles, then compare a mixed-provider setup. Keep each role replaceable. Record model ID, supported reasoning settings, token budget, latency, retries, usage and cost when available. Do not silently substitute an unrecorded model or change production-wide settings to run an experiment. A specific vendor is not assumed to be the best Portuguese writer or factual reviewer.

## Evaluation protocol

Use six development cases and twelve fresh reserved cases as an initial operational target. Include recordings/transcripts and written or mixed content, short and dense inputs, unclear names, competing angles, and conflicting metadata. The 18 published references are style material; they are not automatically 18 matched evaluation cases.

For each case, retain the exact input bundle, confirmed metadata, human article or edited reference, essential-information checklist, and any extra reporting available to the human writer. Supply that extra reporting equally. Cases with unequal reporting remain useful for diagnosis but are excluded from the parity count until their inputs are equalized. A raw AI draft versus an edited publication measures the publication gap, not the model's isolated contribution.

The twelve article-parity cases must have enough shared evidence to support an article. Evaluate insufficient content and unresolved central conflicts separately for an appropriate `needs_reporting` outcome; these cases do not count as either article-parity successes or inferior articles.

The three existing diagnostic cases begin the development set. Capture their original content and source versions before running the comparison:

| Case | Regression question |
| --- | --- |
| Real Fish | Are Tilamax and Universidade Estadual de Maringá preserved when supported by the supplied interview and essential to the selected genetics angle? |
| C.Vale | Does the article keep the supported event identity, or explicitly surface a conflict, instead of mixing APAS and Seafood Show? |
| MSD | Does the technical discussion of sanitary costs survive alongside the vaccine and market outlook when supported by the input? |

Compare the current flow, the new flow with the same model, and the new flow with different models. Freeze the candidate before opening the reserved cases. Run each reserved case twice and retain both outputs; no best-of selection. Further tuning on a reserved case turns it into development material and requires replacement cases for the next final evaluation.

Two journalists independently judge anonymized, order-randomized articles, preferably not their own. First use the same visual presentation while preserving each article's paragraph and heading decisions; then inspect the actual publication presentation on desktop and phone. Resolve disagreements with an editor and retain the original ratings. Ask about perceived authorship only after judging quality; guessing authorship is not the success criterion.

Agree on these rating anchors before opening the reserved cases, and record the paired judgment against the human reference in addition to the category:

| Rating | Anchor |
| --- | --- |
| Publishable with light editing | Local copy or presentation adjustments; no new reporting, central-angle change, material factual correction, or recovery of indispensable information |
| Substantive editing required | The source supports a viable article, but its angle, attribution, information selection, progression or composition needs substantial repair |
| Rejected | A critical factual distortion, fabricated quotation, or other defect prevents approval of this version |

For editing-time comparisons, measure active editing separately from waiting, additional reporting and tool incidents. Counterbalance order and allocation between editors so familiarity with a case does not consistently favor one version.

| Dimension | What the reviewer records |
| --- | --- |
| Fidelity and attribution | Unsupported claims, invented quotations, wrong speaker, wrong event, lost conditions, transformed forecasts |
| Editorial choice | Angle, lead, hierarchy, useful details preserved, relevant omissions |
| Writing | Clarity, specificity, progression, naturalness, repetition and promotional language |
| Presentation | Title/dek relationship, paragraphs, headings, quotations, links, figures and destination integrity |
| Editing effort | Minutes to approval, factual corrections, recovered information, substantive rewrites and formatting repairs |

Proposed pilot targets: no critical factual errors or invented quotations in either run; quality at least comparable to the human reference in at least ten of twelve cases; approved presentation in every case; at least a 30% reduction in median active editing time against the current flow under comparable conditions. A case counts toward the ten only when both runs are judged at least comparable and publishable with light editing. Presentation and factual requirements also apply to both runs. Record performance by genre and input type. These are proposed business acceptance targets, not statistical guarantees or already achieved results. Newsroom participation and repeated evaluation on new material are required before making a general quality claim.

## Implementation acceptance checklist

Checked items represent implemented and locally verified behavior. C2/C3 still require connected acceptance; these checks are not a release or editorial-quality verdict.

- [x] Map and guide have editable frontend controls, acknowledged save contracts, recent history and concurrency protection.
- [x] Article calls consume an immutable policy snapshot included in the request cache identity.
- [x] The managed writing path accepts identified source content without requiring a news record; intake support for particular file types remains separate.
- [x] Fixed input snapshots produce deterministic prompt composition without an intervening model call.
- [x] Queued jobs retain their policy snapshot; prompt/cache identity includes task, source, temporal context and supplied policy/example data.
- [x] Writer and reviewer receive original source segments; central reporting gaps can stop generation and remain visible outside the article.
- [x] The managed path combines task contracts with the saved map and guide; existing custom configurations are not replaced on load.
- [x] Correction is bounded and independently reviewed; unresolved original major/critical findings and incomplete essential-fact audits prevent readiness.
- [x] Recorded provider comparisons keep exact local configurations and outputs without activating shared settings or exposing credentials.
- [ ] C1: close the known editorial refinements and supported-abbreviation false positive, preserving the baseline and essential meanings.
- [ ] C2: verify the saved configuration, real generation and persistent execution history together through the connected frontend.
- [ ] C3: verify title, dek, body, applicable media and quotation integrity across editing, review, approval and supported delivery paths.
- [ ] C4: complete six distinct development cases with newsroom judgments and active editing records.
- [ ] C5: deliver the exact validated version through the approved repository workflow and verify the active configuration and release.

Tracked outside this closeout:

- [ ] Notícias integration with the single versioned editorial map, owned by the news workstream.
- [ ] Detailed per-rule prompt manifest and broader removal of obsolete policy copies from legacy flows.
- [ ] Reserved-case evaluation before a general claim of editorial parity.

Local implementation and verification follow `DEVELOPMENT_HARNESS.md`. Remote pushes, PRs, merges and deployments remain separate actions subject to its exact-action approval rules. This plan does not authorize activity in the other Notícias chat or a production release.
