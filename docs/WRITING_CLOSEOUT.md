# Writing closeout — October 21, 2026

The implementation is technically ready for the remote delivery decision. It has not been pushed, released, or activated in the shared workspace. The six-case human editorial acceptance criterion remains open: these results do not establish parity with Seafood Brasil or permission to publish the generated articles.

## Implemented and accepted

- The editorial map, writing guide, stage models, prompts, review criteria and direct Tavily research controls are editable in the frontend. Saved revisions and each execution's effective configuration remain inspectable.
- Original content reaches planning, writing, review and the bounded correction. Essential meanings, literal quotations, uncertainty and temporal scope are checked separately from editorial preferences. Missing reporting has an explicit outcome.
- Web research records queries, retained excerpts, URLs, dates, request IDs and reported credits. Original and external evidence remain separate. Accepted research sources persist with the article, including versioned references and export metadata.
- The connected frontend passed real generation, reopen/inspection, a persisted manual edit and undo, review, technical approval, clipboard copy and actual HTML, Markdown and manifest downloads. Desktop and 390 px inspection had no page/console errors or horizontal overflow. A separate real failure/retry/cancel path also passed without further generation calls.
- Acceptance defects were corrected: HTML markup in retrieved source titles, an empty event-box footer, missing external references in generated/edited version snapshots, absent web URLs/dates in the manifest, and lexical false positives for supported state abbreviations and hyphenated compounds such as Ômega-3.

No database migration is needed. News intake, RSS, CMS publishing and archive RAG remain outside this delivery.

## Exact validation evidence

Live provider and connected export acceptance ran on production build commit `4db6960d8ca67179d4b4bfaa24c0eb4063c7e623`. The closing documentation commit changes no application code. Its exact hash and final verification logs are recorded in the private evidence package, under `verification/`.

| Check | Result on the application acceptance commit |
| --- | --- |
| Quick gate: repository policies, lint, types and tests | 1,573 tests passed |
| Backend suite | 235 tests passed |
| Production compilation | Passed |
| Browser smoke | 61 passed; one existing desktop-only reorder scenario intentionally skipped at 390 px |
| Connected generation through downloaded export | Passed, with actual OpenAI, Anthropic and Tavily calls |

The final connected production is `0b499be3-a132-4008-861a-f7fc15fa2200`; its execution is `81b35853-fc13-4aae-8933-8151544bdafd`. One Tavily query returned three retained sources and reported one credit. The article used one external source. The export proof checks source references from the title, dek and body, exact source versions/hashes in generated v1 and edited v2, and all persisted research metadata in the manifest. Copy and downloaded article bodies match approved v2. Approval here is a functional test, not a journalist's publication verdict.

This test explicitly requested technical context and temporarily instructed the planner to use `site:woah.org ISKNV infectious spleen kidney necrosis virus`. The instruction was saved through the frontend, used by the actual API request, and removed through another frontend save after acceptance. The completed run retains its original snapshot. No preflight results were injected. The earlier connected attempt with zero retained search results is preserved as an empty-search outcome, not presented as a failed provider call or as external-source export proof.

Private evidence stays in `.reporter-local/pilots/2026-10-21-closeout/`, outside Git:

- `frozen-ready.json` and `activation-candidate.json`: exact candidate policy, model parameters and instructions; no source transcripts in the activation file.
- `FINAL_REPORT.md`, `final-evaluation.json`, `agent-assessment-*.json` and `review-packet-runs-network-enabled/`: six-case outputs, independent agent readings and unfilled human review forms.
- `connected-targeted/generated-run.json`, `state.json`, `export-version-proof.json`, `research-restored.json`, downloads and screenshots: final connected evidence.
- `connected/` and `connected-final/`: prior attempts and observed failures, retained without rewriting their historical outcomes.

## Editorial result and remaining acceptance

The frozen batch ran six distinct development contents: four supported original contents and two hand-written fixtures derived from published articles. It produced five articles marked `ready_for_human` and one reporting stop. These are not six independent holdouts or six approved articles. All five batch research stages skipped web queries because the frozen briefs requested original-source reporting; the separate connected test above proves live Tavily use.

| Case | Recorded outcome | Required editorial action |
| --- | --- | --- |
| MSD interview | All eight original substantive meanings retained; 234 body words and a 113-character dek | Journalist evaluates prose and formatting against the preserved baselines |
| Seafood Show advance announcement | Correctly stopped because the original relative-date brief was stale | Obtain reporting or explicitly choose an announced-program angle; provide a suitable sixth article for the agreed six-article acceptance |
| Medium interview | Seven principal topics retained, including capacity and ROI qualifications | Copy edit and record active editing time |
| Long retail podcast | Core content retained; source is an ASR transcript | Confirm or omit the spelling “EC Construtoria”; audio has not been independently checked |
| Hecke | Five principal themes retained | Reduce lead/dek repetition; this derived fixture is not a holdout |
| Apex | Automatic review missed a crowded 105-word lead and a generic repetition | Restructure the opening and remove repetition before approval; this derived fixture is not a holdout |

The supplemental-web MSD variant also needs editorial work: a dense taxonomy paragraph, vague identification of the external report, and an oral image in the closing. The lexical checker rejected “WOAH” even though it appears in the search-result title/domain, causing a less precise attribution after correction. This is a recorded grounding false positive, not an unsupported institutional claim proved false. The retained excerpt supports the technical statements, but neither the excerpt nor this test verifies the full document or current taxonomy. The issue does not prevent frontend editing and is not hidden by the successful export test.

João or the designated journalist supplies the human verdicts and editing times in the prepared packet. Engineering cannot fill those as if they were human judgments. The current batch does not meet C4's requirement that all six articles pass with light editing. Shared prompt changes in a later calibration require rechecking affected cases; do not replace these frozen outputs silently.

## Configuration activation after an approved release

Use `activation-candidate.json` as the exact candidate values. Its source `frozen-ready.json` has SHA-256 `ae82765aba0db234acd3162c5bdc405ab98285b54740bd6d9d3c7c6a22c7032f`. Do not copy the targeted functional-test override into the general instructions. Version numbers, IDs and saved-at metadata are assigned by the application when saving, not manually copied from local acceptance.

1. Record the current shared map, guide and active prompt revision before changing them. Confirm OpenAI, Anthropic and Tavily availability. GitHub staging/production secret-name checks found the required names; only the controlled-release preflight establishes authentication. Gemini is optional for this candidate and its secret name was absent from those two lists.
2. In **Mapa editorial**, apply the candidate policy and save. In **Guia de escrita**, review the eight suggested fields and apply the candidate's rules, composition and terminology as appropriate, then save. Loading the screen or opening suggestions does not activate them.
3. In **Prompts → Redação**, enable managed writing and apply the exact candidate instructions and four review criteria. Choose GPT-6 Astra for planning/review and Claude Opus 5.5, high effort, for writing/correction. Output limits are 8,192 and 16,384 respectively; source limit is 100,000 characters, correction limit is one and minimum quotations is zero. Unsupported temperature is not sent to the provider.
4. Enable **Pesquisa de contexto na web** with two queries, three results per query, six retained sources, a 20-second timeout and **Parar e analisar** on failure. Apply the candidate's exclusions and save/activate. Reference articles must remain excluded.
5. Reload the three screens and inspect a controlled new execution in **Prompts → Execuções**. Confirm the active model/policy snapshots, separation of source and execution dates, source provenance, review findings and exported approved version. Keep publication under human approval.

To recover the prior prompt configuration, use **Prompts → Histórico → Carregar para edição**, review and save it as the active configuration. This deliberately preserves the current editorial map/guide. Restore those separately in their own editable screens from the values recorded before activation. Disabling managed writing or web research affects future runs; an existing run retains its snapshot and must be canceled explicitly if necessary. Code rollback follows `RELEASE_RUNBOOK.md`.

## Remote delivery boundary

The branch contains cohesive local commits under the authenticated GitHub identity. No push, PR, merge, Preview, deployment, version bump or shared configuration write was performed. After the exact remote actions are approved, follow `DEVELOPMENT_HARNESS.md` and `RELEASE_RUNBOOK.md`: review/merge by rebase, controlled staging acceptance, then the deliberate production workflow. The workflow prepares the product version; do not fabricate a release version for this local candidate.
