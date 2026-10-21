# Managed writing orchestration

This implementation is local until delivered through the repository release workflow. It connects the existing article-generation entry point to an optional whole-article workflow. It does not change the news intake, radar, CMS integration, or automatic publication.

## Administration

Administrators open **Prompts → Redação** (`/config?tab=writing`). They can enable the workflow, choose the provider model for each stage, edit shared and stage instructions, set supported temperature, reasoning effort and output-token limits, set the maximum source length, and allow zero or one correction cycle. Four editable review criteria cover factual fidelity, portal editing, essential-fact preservation and correction resolution. **Salvar e ativar** creates a pipeline revision. Existing workspaces keep their current flow until this option is enabled and saved. Restoring the suggested instructions is an explicit action; loading an older configuration does not replace its custom prompts.

The minimum quotation count is also editable: zero means selection by editorial usefulness, one through five impose an explicit minimum, and **Padrão do formato** inherits the selected format. New orchestration configurations default to zero. Older configurations without the field retain their format's previous minimum, including zero for short notes. `null` explicitly restores inheritance; an omitted field from an older settings client cannot erase the saved choice. Quotation authenticity is always checked, even with a zero minimum.

The editorial map and writing guide remain editable in `/settings/editorial-map` and `/settings/writing-guide`. They define audience, scope, voice, title, dek, lead, attribution, terminology, composition, and example observations. Stage instructions describe the task; they do not replace the outlet policy. Their shared revision lock prevents one administrator from overwriting a concurrent change.

**Revisar sugestões** in the guide opens a before/after preview for voice, title, dek, lead, attribution, paragraphs, headings and closing. **Aplicar ao rascunho** replaces only those displayed fields in the local draft; the administrator can edit them before saving a new version. Canceling or opening the screen changes nothing. Other rules, terminology, examples and composition fields are preserved. The suggestions are configuration values, not an extra instruction layer injected behind the saved guide.

For an existing source, **Contexto e falantes → Data do material** edits the optional recording/collection date. Clearing the field removes the date rather than substituting today. The command validates the date, requires edit permission and access to every production sharing the source, and compares the date seen when the drawer opened. A conflict preserves the draft. Successful changes record the old and new values, actor and time in activity and Logs; transcript versions and past execution snapshots remain unchanged.

The composition preview shows the actual compiler output without a paid call. Its source and execution dates are editable simulation values, not saved production metadata. Content entered there is preview data, not a saved production. Start a production or retry a failed generation to evaluate a model on real content. A retry uses the **currently active saved configuration**; its earlier execution retains the original snapshot. Model quality comparison and blind newsroom evaluation remain a separate calibration task.

## Execution

1. **Prepare and plan:** read the original content, identify supported facts and their evidence, choose an angle, record essentials, progression and reporting gaps.
2. **Write:** return the entire title, dek and semantic body in one call.
3. **Review:** compare the complete article with original content and the exact map and guide snapshot. Record factual and editorial assessments separately, and classify every essential fact as preserved, partial, missing or contradicted with literal article passages and original evidence references. The reviewer receives no writer identity or self-evaluation.
4. If configured and necessary, **correct once**, then run an independent review again using the original plan, original content, previous article, previous findings and corrected article. Every previous finding receives an explicit resolved/unresolved result. Normal execution uses three calls; a correction uses five. Transport retries may repeat a failed call and are observable separately.

All stages receive complete original, nonempty source segments, including questions and multi-sentence passages. Existing ingestion/transcription supplies those segments; this workflow does not parse new file formats. It does not replace original material with a facts-only summary. Content above the editable character limit stops with an actionable error, rather than truncating silently. The limit is not a guarantee that every provider will accept an equally large prompt.

The compiler combines visible integrity rules, shared instructions, versioned outlet policy, stage instructions, and production data. Source material and prior model output are data. Example URLs are stored editorial references and are not fetched by generation. The compiler version, resulting prompts, schema, model and parameters participate in cache identity.

The existing production format and length contracts still apply, with the configured quotation minimum replacing the format minimum when explicitly set. The same resolved minimum appears in prompt instructions and deterministic checks. A model's approval cannot override a failing evidence, quotation or size check. Output with unresolved substantive issues or missing reporting stays in the execution record, rather than becoming a ready draft. A completed draft remains marked **unreviewed** until a person reviews it.

The v2 output contract requires exactly one audit entry per original essential fact and previous finding. It rejects unknown IDs, invented or empty normalized passages, evidence references unrelated to the planned fact, and a ready verdict with incomplete facts or unresolved substantive findings. A claimed resolved correction cannot approve an unchanged article. These checks establish traceability and reject inconsistent verdicts; they do not independently prove semantic preservation. The reviewer still has to judge whether the cited passage retains the complete meaning, including purpose, time horizon, scope and qualifications. The planner must identify independently losable claims separately rather than hiding them inside a broad topic.

The v3 contract added exactly one editorial check for hierarchy, economy, quotation usefulness, language and uncertainty. Each check records a reason and inspectable passages; a `revise` result on an axis must reference an existing substantive finding and prevents approval. These checks apply the saved criteria and outlet policy. They do not create an automatic numerical quality score. Uncertainty includes secondary statements, not only the essential-fact list. Planning distinguishes central information from dispensable corporate praise; deleting the latter is not a loss of factual substance.

Compiler `editorial-orchestration-v4` keeps these five axes. Its suggested instructions distinguish substantive defects from optional alternatives and cover temporal support, angle alignment, paragraph continuity, semantic repetition and oral phrasing. Broad company/event coverage may legitimately emphasize a product in the title and a supported market complement in the dek; a different preferred focus alone is not a blocker. Every old finding still receives an audit entry after correction. An unresolved original `minor` suggestion may remain visible; an original `major` or `critical` finding blocks readiness even if a later response labels it minor. A top-level model verdict of `revise` with only optional suggestions is normalized to `ready_for_human` only when all essential facts are preserved, all five axes pass, and all original substantive findings are resolved. `needs_reporting` is never normalized this way. The explanation is recorded in the review summary and the raw verdict remains in `providerOutput`, including cache replay.

The unchanged-correction guard compares the publishable title, dek and ordered block content. Renaming block IDs or changing references alone cannot support a claim that an editorial correction was resolved. This is not semantic proof that a textual edit fixes the finding. A provenance-only repair does not yet have a separate resolution type and may require human handling rather than automatic readiness.

Every stage receives `brief.temporalContext`: the execution day in the newsroom timezone and each source's ID, title and supplied `recordedOn` date, or explicit `null` when unknown. An event remains separately identified in the brief. Execution, upload and source-version creation dates do not establish when a statement was made. Source dates participate in source grounding; the execution date does not. This context is captured in prompts, snapshots and cache identity, while source metadata also participates in the queued job's context hash. Older traces without it say that it was not recorded. An undated source may support a conservative event account; an unsupported current claim essential to the angle requires reporting.

A preserved fact requires at least one cited article passage linked to its original evidence. Additional literal passages may supply transitions or context with other references. A diagnosis of partial or contradicted coverage may point to a block whose original reference was lost: rejecting that diagnosis would prevent the reviewer from explaining the failure. It still cannot receive a ready verdict.

## Observability and management

**Prompts → Execuções → Ver execução** reads an admin-only, tenant-scoped endpoint. The inspector exposes:

- Run status, failures, stage decisions and localized findings.
- Factual and editorial assessments, each essential fact beside its current article passage and original source, and the result of each requested correction.
- Five editorial checks with passages, reasoning and linked findings. Historical records without these checks are explicitly identified.
- The selected angle, ordered outline and reporting gaps outside the publishable body.
- Source dates, execution day and event context as distinct recorded values; unknown dates are not reconstructed from run timestamps.
- Pending optional suggestions with their original severity and current correction assessment, without presenting them as resolved.
- Exact system prompt and input sent at each stage, and the recorded output.
- Original model verdict separately when deterministic checks override it.
- Model, effective output-token limit, supported temperature or reasoning effort, provider, request ID when supplied, duration, available token usage and cache reuse.
- The immutable map, guide and orchestration snapshot.
- The configured quotation minimum and its effective value when recorded, without inventing a number for historical runs.
- Cancellation, a new attempt with current saved settings, and navigation to the production article.

The run list carries only summary metadata. Full prompts and content are loaded on demand; general workspace projections and operational logs do not contain them. Running requests are polled without replacing unsaved settings. Cancellation revokes the worker lease and settles pending traces, so a late response cannot commit an article. Automatic retries retain separate trace identities and consumption already reported by providers. Missing token usage is shown as unavailable. Mixed-model runs are identified separately in the platform usage dashboard, without pricing all stages at the writer's tariff; individual models and consumption remain visible in the inspector.

## Providers and storage

OpenAI, Claude and Gemini use server-side direct API adapters. The model catalog is explicit, with provider-specific parameter bounds and capability handling. Existing Groq models remain available for compatibility. API credentials are environment configuration; the frontend sees only availability flags and cannot read keys. Gemini accepts `GEMINI_API_KEY` or `GOOGLE_API_KEY` and is optional for older installations.

Claude Opus 5.5 and Fable 5.1 use adaptive reasoning with editable effort (`low`, `medium`, `high`, `xhigh`, `max`); unsupported temperature is not sent. Their application output limit is 32,768 tokens. Existing Sonnet 4.6 selections remain intact. The resolved effort is recorded and participates in both writing and legacy pipeline cache identity. Provider reasoning content is not exposed as article output.

`PipelineDefinition.writing` stores orchestration settings. Each queued job captures its `PipelineRevision`; `EditorialJob.writingTraces` stores requests and responses in the existing durable job document. No new database migration is required. Source references, semantic paragraphs/headings/quotes/lists, and dek survive the conversion to the normal editable article and event persistence. Approval and export continue using the existing document contract.

`GenerationRun.articlePolicy.minimumQuotes`, captured from the queued configuration, keeps the resolved quotation rule with the generated article. Editing, approval, assistance and restored versions resolve that rule through version ancestry and its generation run, not the workspace's current settings. A fresh legacy generation starts a new lineage with its original format rule. Article text cannot supply or overwrite this metadata.

## Verification boundary

Deterministic tests exercise request composition, strict output validation, evidence IDs, literal quotations, original-content preservation, three/five-call paths, bounded correction, cache invalidation, cancellation, tenant authorization, revision conflicts, persistence, and semantic handoff. Preservation regressions include loss of a long-term purpose after shortening, incomplete fact audits, fabricated or invisible passages and unresolved previous findings. Browser scenarios use mocked APIs to verify editable criteria, model and effort changes, unsaved-state preservation and structured run inspection on desktop and phone. Historical runs without the v2 audit explicitly show that no structured verification was recorded.

Those checks establish software behavior. They do not establish that a chosen model matches Seafood Brasil's editorial quality. That requires fresh content, real provider runs, side-by-side newsroom review, and recorded editing effort. No paid provider run is implied by mocked acceptance tests.

## Recorded preservation pilot — October 21, 2026

The MSD Aquishow interview was repeated with the exact revised transcript and map/guide from the earlier targeted pilot. Planning and review used GPT-6 Astra; writing and correction used direct Claude Opus 5.5 with high effort. The published Seafood Brasil article was withheld from generation. The run and its configuration were saved locally without changing the active workspace or publishing an article.

| Observation | Previous targeted pilot | Preservation pilot |
| --- | --- | --- |
| Long-term purpose of the sanitation-cost discussion | Lost after correction | Retained after correction |
| Essential-fact audit | No structured per-fact record | Eight original essentials present, with passages and sources |
| Correction audit | Global approval missed the omission | One requested correction explicitly checked and resolved |
| Body words, using the same application counter | 238 | 378 |
| Calls / elapsed time | 5 / 110.5 seconds | 5 / 150.7 seconds |

A separate real review of the unchanged previous article, without a hint about the known omission, requested revision and identified the missing long-term purpose. Its first validation exposed an overly strict evidence-link rule for negative findings; the contract was repaired and the same captured response was revalidated without another paid call. The raw-transcript case stopped at planning with explicit reporting gaps around the vaccine identity and truncated speech. These three scenarios used seven paid provider calls in total.

Independent reading confirmed the preservation improvement but not a general editorial-quality improvement in that pilot. It delayed the technical topic with institutional context and retained a long oral quotation with a repetitive introduction. The reviewer accepted these weaknesses. A nonessential assertion about attendance at every event edition also needed more conservative handling of the source's uncertainty. These observations motivated the subsequent v3 editorial checks, criteria calibration and configurable quotation minimum.

One run per condition, with both prompts and models changed, does not isolate model quality. The revised transcript's names, terms and interview date have not been independently checked against original audio. A real-trace UI replay passed at 1440 and 390 pixels, but its screenshots are not evidence of a persisted cloud execution.

## Recorded editorial calibration — October 21, 2026

Two further MSD runs kept the exact source, editorial map, models and generation parameters from the preservation pilot. The changed variables were the writing guide, visible task instructions and review criteria, v3 audit contract and explicit zero quotation minimum. The final guide revision asks for only indispensable opening context and one central dek complement. All policies and outputs are saved locally; the shared workspace configuration was not activated or overwritten.

| Observation | Preservation baseline | First v3 revision | Final v3 revision |
| --- | --- | --- | --- |
| Body words, same application counter | 378 | 258 | 262 |
| Dek characters | 225 | 231 | 149 |
| Calls / elapsed time | 5 / 150.7 seconds | 5 / 176.3 seconds | 5 / 170.1 seconds |
| Long-term purpose of sanitation-cost discussion | Present | Present | Present |
| Editorial audit | No five-axis record | Five explicit checks | Five explicit checks |

Independent reading found a clearer progression in the final version: product, technical costs, then market outlook. It removed participation history, corporate jargon and a long quotation that repeated its introduction. The final lead dropped vague regional relevance, while its single direct quotation retained the forecast qualification “creio que”. Length is an observed outcome, not a quality score or a new target.

Essential-fact counts are not directly comparable between plans. All eight substantive topics in the 258-word revision remain in the final article, although the new plan uses seven essential IDs: it splits the forecast horizons, combines market causes and retains the Minas Gerais destination and investment confidence as nonessential facts. The older 378-word plan had also marked a generic assessment of ten years of progress as essential; the new criteria intentionally remove that assessment when it adds no concrete explanation. This editorial reclassification is recorded explicitly rather than described as literal preservation of every old essential.

A separate real review of the unchanged 378-word baseline requested revision without hints about its known failures. It identified lost uncertainty about attendance at every event edition, institutional padding and quotation redundancy. The final generation's first review requested two corrections; the second verified both as resolved and retained all seven current essentials. The two generations and negative control consumed eleven provider calls, with 144,643 input and 32,820 output tokens reported in total.

Remaining editorial weaknesses include the awkward source wording “vacina de ISKNV”, a forecast paragraph that still repeats optimism before giving its time horizon, and an isolated investment sentence that could join the prices paragraph. One interview does not establish parity with the published newsroom reference or isolate the contribution of each changed instruction. The next editorial evaluation should use held-out content and record human editing effort.

The local evidence package is under `.reporter-local/pilots/2026-10-21-editorial/`: `evaluation.json` records the comparison and fact crosswalk; `polished/article.md` contains the final unedited model output; each run retains prompts, policy snapshots, traces and provider usage. The final trace replay passed at 1440 and 390 pixels without page errors or horizontal overflow, using read-only mocked endpoints populated with the actual traces. Software validation passed the quick gate (1,557 tests), backend suite (212 tests), eight targeted desktop/mobile browser scenarios and production compilation. No article was published.

## Recorded temporal and editing refinement — October 21, 2026

The v4 round kept the 262-word final v3 article as its immutable baseline. Both new candidates used the same source hash, editorial map, direct models and generation parameters: GPT-6 Astra for planning/review and Claude Opus 5.5 with high effort for writing/correction. The execution reference day was frozen to the baseline's October 20 for the comparison, while actual call timestamps were recorded. The interview date stayed unknown. The published Seafood article was withheld and no generated article was manually edited before measurement.

| Observation | Frozen v3 baseline | First v4 candidate | Refined v4 candidate |
| --- | --- | --- | --- |
| Body words, same application counter | 262 | 363 | 246 |
| Calls / elapsed time | 5 / 170.1 seconds | 5 / 181 seconds | 5 / 185.4 seconds |
| Temporal framing of the market assessment | Present continuity in the dek | Situated in the event/interview | Situated in the event/interview |
| Generic institutional material | Mostly removed | Reintroduced | Removed by review/correction |
| Investment consequence | Isolated paragraph | Connected to price assessment | Connected to price assessment |
| Oral image about the producer | Retained in narration | Removed by correction | Removed by correction |

The first candidate improved temporal framing but regressed in selection: broad regional importance, generic sector progress and company satisfaction returned. Its model approval did not establish an overall editorial improvement. The guide revision had weakened the earlier removal test while adding new flow guidance. The final candidate restored that explicit selection criterion alongside temporal and narration guidance. Both attempts and their controls are retained rather than reporting only the chosen result.

Two separate real reviews of the unchanged baseline tested the criteria without hints identifying the known problems. The first flagged time scope and unclear oral phrasing but also treated a product-title/market-dek combination as a mandatory hierarchy defect. After calibration, the second accepted that valid combination, retained the two substantive findings and marked paragraph integration as an optional suggestion. This is evidence of a better distinction on the same case, not proof of reliable severity calibration across a newsroom.

Independent agent reading of source and articles confirmed the concrete topics in the final candidate: product and Minas Gerais destination; sanitation-cost discussion and its long-term purpose; feed/sanitation/genetics comparisons with pigs, poultry and salmon farming; 2026 prices versus 2024/2025, including the post-Lent qualification; investment confidence; climate, availability and liquidity explanations; and both 2027 horizons with the literal “creio que” qualification. The final model audit recorded seven preserved essentials, five passing editorial axes and three resolved findings. These model-selected ID counts do not replace the semantic crosswalk or human assessment.

Remaining polish is visible: the dek grew from 149 to 210 characters and covers two subjects; “torna o cenário” is less conservative than past tense inside the retrospective narrative; and “ele manteve a ressalva” makes the closing introduction sound like an editing note. The writer still needed correction for generic material and oral imagery. Lexical grounding also flagged `MG` despite the source naming Minas Gerais; removing the abbreviation is not evidence of a factual hallucination corrected. Technical product wording, names and the revised transcript remain unverified against original audio or external documentation. No additional reporting was fabricated to match the published reference.

The evidence package is `.reporter-local/pilots/2026-10-21-refinement/`. Its `evaluation.json` contains metrics, controls, the factual crosswalk and residual limitations. The first candidate is under `msd/`; the chosen raw output is `refined/msd/article.md`, with its exact prompts, policy, provider responses and usage alongside it. The two generations and two controls used 12 provider calls with 166,392 input and 37,607 output tokens. No cost estimate is invented without verified pricing.

The integrated quick gate passed 1,565 tests; the backend suite passed 223; 18 targeted desktop/mobile browser scenarios passed; and production compilation passed. Actual final traces were replayed through read-only mocked endpoints at 1440 and 390 pixels, checking all five stages, dates, plan, gaps, findings and original verdicts without console/page errors or horizontal overflow. This replay is not a persisted cloud execution. Frontend controls are implemented locally; the saved shared policy was not overwritten, no deployment ran, and no article was published. Broader development cases and blinded journalist evaluation with measured editing effort remain outstanding.


## Direct web context for writing

Tavily is an optional direct API integration. Enable it in **Prompts → Redação → Pesquisa de contexto na web** and save the configuration. Legacy configurations keep it off. The existing planning call proposes up to three grounded queries; one bounded search batch runs before writing. It does not add a model stage or change the three/five-model-call correction budget.

The frontend manages search instructions, query/result/source caps, timeout, domain/URL exclusions and failure behavior. The map's blocked sites and guide reference URLs also enter the recorded exclusions. The writing provider receives only retained excerpts with separate external IDs, URLs, retrieval dates and publication dates when supplied. Search snippets are not full-page verification. External material cannot establish the interview's date or identity and cannot supply a direct interview quotation. Original essential facts remain fixed by the original-source plan.

The execution inspector records the exact queries, their original evidence links, results, exclusions, provider request IDs, reported credits, timing and errors. Search credits are not LLM tokens. Absent usage is not estimated. Successful results are frozen for the run and all subsequent model stages; a new generation researches again. A failed search is also recorded. **Parar e analisar** stops before writing; **Continuar com o conteúdo original** excludes all partial web results from the model context and visibly skips enrichment. A retry within the same run reuses its frozen search snapshot; start a new generation to perform a new search.

Accepted articles persist their URL excerpts as separate research sources in the same transaction as the article output. Reopening or exporting the article retains its source references. Generated and edited article versions include the exact referenced source versions, including evidence used only by the title or dek; the original run input snapshot is not rewritten. The manifest includes source URLs and recorded research provenance, without exporting raw interview contents or arbitrary provider payloads. Historical research remains resolvable but is excluded from subsequent original-content preparation, preventing web material from turning into interview evidence. Source publication and retrieval dates do not populate the interview date.

The deployment workflow already passes Tavily when configured. The current local credential and the `TAVILY_API_KEY` secret names in both GitHub environments were present during closeout inspection. This checks presence, not production authentication; the controlled-release preflight performs authentication. Gemini remains optional and was absent from those two environment secret-name lists. The frozen acceptance models use OpenAI and Anthropic.

## Closeout acceptance

The [closeout record](WRITING_CLOSEOUT.md) separates technical readiness from human editorial acceptance. Real connected generation with OpenAI, Anthropic and Tavily passed through edit, review, technical approval and downloaded exports on commit `4db6960`. Configuration restoration preserved the completed run's snapshot. The six-case batch produced five articles and one reporting stop; it did not establish six approved articles or human parity. Apex still needs a structural edit, a podcast name needs confirmation and the supplemental-web MSD variant retains prose/attribution issues. The exact private evidence, activation procedure and remaining decisions are listed in that record.
