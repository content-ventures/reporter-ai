# Event coverage formats

João asked for this on 2026-10-19, the eve of Seafood Show Latin America 2026. The tool already turns a lecture or podcast into one long article. A fair needs smaller pieces as well. The reporter uploads the material as before. In the pauta, they then choose the **format**, its **size** and the **deliveries**. The article flow is unchanged: Curto/Padrão, its prompts and carousel. It stays the default.

## Formats

The five formats come from 36 texts that Seafood Brasil published in 2026, at APAS Show, Aquishow Brasil, IFC Brasil and SENA. Seafood Brasil reporters sent 29 of them as references. The catalog with the measurements is at https://claude.ai/artifact/HbowExNCogucWamhUjQJAG.

| Format | Size options (body characters) | Parts | Minimum literal quotes |
|---|---|---|---|
| Cobertura de estande | Enxuto 1,200–2,300 · Completo 2,300–3,600 | H2 intertítulos | 2 |
| Cobertura de painel | Padrão 2,800–4,500 · Completo 4,500–7,500 | H2 per theme or speaker | 3 |
| Premiação | 900–2,800 | H2 per category | 0 |
| Abertura | 2,800–5,000 | H2 per announcement | 2 |
| Nota curta | 600–1,500 | no intertítulos | 0 |

The specs live in `src/domain/formats.ts`. A brief without `format` is the R1 article, and its hash is unchanged.

## What the reporter fills in

- **Formato, Tamanho, Seções and Entregas.** The carousel stays an optional output. It is derived from the approved text, as before.
- **Evento**: name, box title, box paragraph, date, hours, venue, address and closing call. The reporter types it once. The form offers the last event typed on that device ("Mesmo evento da última cobertura: …?"), and fills it only after "Usar". A material from another fair would otherwise go out with the wrong box.
- **Tamanho.** A stand interview of 3 min or more set to Enxuto gets a hint to use Completo (`suggestedFormatSize`). The minutes come from the transcript's duration, or from its words at 150 per minute.
- **The closing box.** It is built from those fields, never written by the AI. It is exported after the body in `.md` and `.html` (`eventBoxLines`).

## Never invent

1. Every paragraph carries evidence ids. Quotations must be literal passages of the transcript (`articleQuotationIssue`).
2. **Grounding** (`src/domain/grounding.ts`). Every number and proper name of a generated part must exist in one of these:
   - the material;
   - the confirmed speakers (name, role, organisation);
   - the typed event;
   - today's date.

   Numbers spoken in words count ("trinta por cento" grounds 30%). If a part fails the check, it is revised with the measured terms (`UNGROUNDED_FACT`). As a last resort, the sentence is removed. The text may come out shorter, but never with an invented fact. The title, linha fina and intertítulos are checked too, and an outline that fails is regenerated.
3. **Repetition**, in event formats only. Three things send a part back for revision with what was repeated:
   - a quotation used twice (`REPEATED_QUOTE`);
   - a sentence restating an earlier one (`REPEATED_FACT`);
   - a person introduced twice (`REINTRODUCED_PERSON`).
4. **Style references are invented.** The opening and part prompts of each funnel embed one invented hard-news text of the format (Pescados Litoral, Feira Modelo 2026 and other made-up names), written to show the pattern. No published text or real company is used. The reference is marked as a fictitious example and "not a source", and grounding removes any of its names or numbers that leak into the text.

## What the text carries

- **Linha fina.** It is planned with the title and saved with it. The cloud rebuilds the "v1 · IA" version from the run's events, so the `outline` event carries `dek` (`articleBodyFromRun`). Versions up to v0.12.0 lost it on save.
- **No AI images.** An event coverage goes out with the newsroom's photos: the worker queues no image planning or generation for a format, and the worker flow on the Prompts page shows no image block.
- **Quotation openings** (`tidyQuoteOpenings`). A spoken opener ("Então,", "Bom,", "Ou seja,", "E") is dropped at the start of a quotation when four words or more remain. A quotation that opens a sentence starts with a capital. The literal check allows that first capital and nothing else (`quoteInSource`), and the citation library keeps the source's spelling.
- **One speaker, no labels (stand only).** A stand recording transcribed without speaker labels, with a single confirmed person in the Material, is that person's interview: the stand funnel attributes the answers to them, and the interviewer's questions are never quoted. The writer never counts a line that names that person, thanks someone or asks for an answer ("Fale um pouco…") as one of those answers (`quotableSpeaker`). Panels, openings, awards, notes and R1 articles have several voices, so an unlabeled line there keeps no name and is never a line a part is asked to quote. When a text does quote one, it attributes it neutrally ("segundo um dos participantes do episódio", "disse um dos entrevistados"). It never invents a name and never comments on the transcript ("voz não identificada", "fala sem autoria").
- **Stand news, as the source says it.** The stand funnel puts the company's novelty (a product, launch, service, partnership, investment, market or number) in the title and the lead. It writes "lança" or "estreia" only when the source calls it a launch, a debut or a novelty; otherwise it writes "apresenta".
- **Self-claims only attributed.** What a company or person says of itself ("único", "pioneiro", "primeiro", "líder", "referência", "carro-chefe") appears only inside quotes or attributed ("que a empresa diz ser o único do mercado"). It never appears in the newsroom's voice or in the title, and it never replaces the fact.
- **The event's name.** Every funnel names the event as `event.name` writes it, because transcriptions misspell proper names. A title that names the event uses the whole name, never a shortened one; when the whole name does not fit, the event stays out of the title.

## Prompts

Each format has a funnel with four prompts in `PipelineDefinition.funnels`: structure (title, linha fina, intertítulos), evidence curation ("Evidências"), opening and parts. The defaults are in `src/domain/format-prompts.ts`.

Every format is written as hard news (notícia). The shared `HARD_NEWS` block is in every structure, opening and part prompt:

- **Lead.** The first sentence is the news: who, what, when and where, in 40 words or fewer, with no quote. It never opens with the event, the ceremony, the programme, the theme, someone's presence or a scene. How or why comes in the second sentence.
- **Inverted pyramid.** Parts go from the most to the least important. The last part ends on its last relevant fact, with no recap, moral or forced closing quote.
- **Headline.** The fact, with a concrete verb in the present tense, a number when there is one, and 90 characters at most. It never uses destaca, aposta em, reforça, discute, debate, marca, leva, traz or foca em.
- **Dates.** The headline and the text may give the day of the fact itself, as the event or the source writes it. The event's period and hours stay in the service box. Outside quotes they never say "hoje", "amanhã" or "ontem", even when the pauta does. Without a date, the fact goes undated.
- **Attribution and tone.** Disse, afirmou, informou, segundo or de acordo com, never ressalta, avalia, pontua or destaca. Every number, forecast and opinion has a source: the person by name when the material identifies who said it, otherwise a neutral attribution to the recording ("segundo um dos participantes do episódio"). No promotional adjective outside quotes, and never "Confira".
- **Quotes.** Short: one idea in one or two sentences. A section carries one literal quote whenever its evidence holds a quotable line: an identified speaker when the material identifies one, never the interviewer, four words or more. A second short quote joins the section whenever its evidence holds another complete sentence or clause with information of its own (a number, a reason, a position or a forecast) that neither the text nor the adjacent paraphrase states: that information is quoted instead of paraphrased. It is never a list fragment, never repeats the sentence before it, is always attributed and is never the interviewer's. Paraphrase and quote alternate: never two quote-only paragraphs in a row, never two quotes in one paragraph. The opening keeps at most one short quote, never in the lead's first sentence, unless the quote plan asks for more. Curation selects that second passage whenever the source has one for the section, up to two per section, never a list fragment or a passage that repeats other evidence. A curated quote that supports a part is quoted, not paraphrased. Round 4 of the rehearsal measured 2.5 quotes per text when the second quote was only allowed ("só quando"), against 3.0 in production. The format minimums do not change.
- **Panels.** Every speaker with a quotable line is quoted at least once, even past the two-per-section cap: that rule prevails. The mediator, host and master of ceremonies are not speakers and are never quoted. Each section is developed with the speaker's arguments, data and examples up to near the target, and stops when the evidence ends.
- **Awards.** Sections are lists with no quotes: every winner, then every nominee or finalist the material names. Nominees split by category go in their category's section. A list the source does not split never sits under a category heading. It takes the pauta's last section, titled "Indicados" (or "Finalistas"), and neighbouring categories share a section ("Categorias [Nome] e [Nome]") to make room. Each winner of a shared section carries its category. With a single section, it is "Vencedores e indicados". The outline keeps the pauta's section count, which the server validates, so the format's range (1–6) does not change. The lead names the winners, never only the categories. A number of winners or nominees appears only when the source writes it.
- **Notes.** The lead states what happens or is announced, not only who attends. An attendance ("participa da abertura") opens the note only when the material has no other fact. The second sentence never describes the event itself ("A feira reúne empresas e profissionais…"), because the service box does.

The opening selects up to four evidence ids, so the lead's fact can come with every sentence of the quote that supports it. The limit is the same in the outline and curation schemas (`pipeline.ts`, `editorial-outline.ts`, `pipeline-output.ts`).

An opening id never returns in a section. When an outline or a curation answer repeats one in the section on the same subject, `withoutOpeningRepeats` (`editorial-validation.ts`) drops it from that section before the answer is validated and cached. Estrutura and curation then read the plan without the repeat. A section left with only opening ids stays as it came and is rejected, and so is any other repeat inside a part or between sections. On 2026-10-21 the staging acceptance ran preset 3.0 with gpt-4.1 on a long R1 article, and the outline repeated an opening id in 10 of 11 calls. Every draft failed after three identical attempts. Reviewed outlines keep their own rule, "Cada citação entra em uma seção só."

A format job curates its evidence with the funnel's own Evidências prompt, which keeps the format's quote minimum (`sizing.minQuotes`), its opening ids and its rule on quotes. The workspace's shared quotes step is now the article's only. Curation still runs only when "Selecionar evidências antes da redação" (`curateQuotes`) is on.

The Prompts page lists them under "Funil · …" and versions them with the rest. Workspaces saved before the funnels, or before the curation prompt, get the defaults through `withFormatFunnels`. Only the funnel steps someone edited are stored, so untouched funnels follow the code defaults. Adding the funnels never changes a workspace's article prompts: those change only when an admin applies a preset (below). The funnels use the model of the workspace's writing step.

A format job writes part by part (`formatPipelineDefinition`). It reuses the measured budget, literal-quote and revision mechanics of the article.

## Preset 3.0: the article as hard news

The article prompts ship as **editorial prompts 3.0** (`defaultPipelineDefinition`). Models, temperatures and token limits are the same as in 2.0.

- **System message.** It carries the same `HARD_NEWS` block as the funnels, so the R1 article follows the same lead, order, headline, attribution, self-claim and quote rules.
- **Planning.** The outline decides the news first and makes it the title, with a concrete verb and none of the banned ones. The outline and the curation select up to four opening ids. Curation asks for `sizing.minQuotes` distinct quotes, with one quotable line per section when the source has one and a second only under the quote rule above. A quotable passage is an identified speaker's line or, in a recording without speaker labels, an answer, never the question.
- **Writing.** The opening starts with a lead of 40 words or fewer, with no quote. The sections and the single-call article add a second short quote whenever the quote rule above finds one, alternating paraphrase and quote. While the text still lacks its minimum (`sizing.quotePlan.quotesStillNeeded`), a section quotes a short line of its evidence even without an identified speaker, attributed neutrally as part of the episode. A missing quote goes to the section whose evidence supports it. The last section ends on the least important fact and never on a list quote. The sections go from the most to the least important and prefer `curated: true` entries. Outline, curation, opening, sections and the single-call article read `{{people}}` for names and roles.
- **Long materials.** When a passage holds a quotable line of an identified speaker, the facts step copies it word for word, with the speaker and its id, in at most five records. An interviewer's question is never copied.
- **Assistant.** It keeps its three tones, and all three write hard news. It reads neither `{{people}}` nor `{{event}}`, because it does not receive them.
- **Unchanged.** The R1 article gets no linha fina, no grounding and no change to house punctuation.

A saved revision is never upgraded silently. A queued job runs the revision it snapshotted, and `activePipeline` never rewrites prompts. Production keeps revision 1 until an admin applies 3.0 on the Prompts page:

1. The page shows "Prompts padrão 3.0" when a prompt still holds a default that an earlier release shipped. The banner counts those prompts, and the customised ones that stay as they are. The catalog marks each such prompt "Padrão anterior".
2. "Ver mudanças" shows one diff per prompt, from the current text to 3.0. "Atualizar para 3.0" saves the result as a new revision, and the previous one stays in Histórico. The button waits while the page has unsaved edits.
3. A prompt counts as untouched when its text hashes to a shipped default (`KNOWN_DEFAULT_PROMPTS` in `src/domain/pipeline-preset.ts`). An untouched prompt moves to 3.0 and keeps its model, temperature and token limit. A customised prompt is kept, and a missing step is added. Stored funnel steps follow the same rule.
4. A changed default adds its hash to `KNOWN_DEFAULT_PROMPTS` and never removes one; tests enforce both. An older build counts hashes it does not know as customised, so it cannot downgrade a prompt.
5. To roll back, open Histórico, load the previous revision for editing and save it again.

## Curated quotes

A quote in Citações is **curated** when all of these hold:

- a person saved it (revision 1 or later);
- its author is confirmed and linked to a person;
- its words are still literal in the authorized source version it names;
- it belongs to this production.

`src/domain/evidence-hints.ts` maps each curated quote to the sentences of the material that carry it.

- **Planning.** The outline and curation source ends with "FALAS CURADAS": the curated lines with their ids and, when filled, the newsroom's note on why they matter (the "Contexto" of Citações), newest first, up to 4,000 characters. The note is labelled as the newsroom's and not a source, and the structure prompts say no fact of it may reach the title, the linha fina or the intertítulos. A material that reaches the prompts as summaries loses its exact words. Its source also ends with "FALAS LITERAIS CITÁVEIS": exact sentences of 8 to 60 words, up to 6,000 characters, from the beginning, middle and end of the material. They come from linked speakers, or from the only confirmed person of a stand recording without labels.
- **Writing.** Curated entries of `literalEvidence` carry `curated: true`, never the note, so nothing a person typed about a quote can become a fact of the text. The writing steps never see the planning lists, so a quote still comes only from the passages the outline selected.
- **Only when the prompt explains them.** The planning lists are added only when the outline prompt names "FALAS CURADAS". The writing marks are added only when the opening prompt (or the single-call article prompt) names "curated: true". The funnels and the 3.0 prompts name both. Revision 1 names neither, so its prompts and the source its steps receive stay the same until 3.0 is applied. Its outline and curation calls still miss the old cache once after the release: their response schemas now accept up to 4 opening ids, and the schema is part of the cache key (`executePipelineStep`). Those two calls are made again for each production, and the outline can come back different; its prompts still ask for at most 2 opening ids.

A curated quote passes the same literal check as any other quote.

## Suggested citations

After a text is written, the outline passages it did not quote go to the citation bank as suggestions (`src/domain/citation-suggestions.ts`).

- **Which passages.** Only the words of a linked speaker in an authorized source qualify, never an unattributed voice or the interviewer. Sentences that touch are joined into one passage of up to 1,200 characters. A passage that overlaps a quote of the text is left out.
- **Limits.** A suggestion is stored with `origin: 'outline'`, revision 0 and the author not confirmed. A run adds at most 10, and a production keeps at most 40. Suggestions do not count toward the 5,000 entries that people and texts keep.
- **A later quote wins.** When a text quotes the same words, that quote replaces an untouched suggestion, in the bank and in the list.
- **On Citações.** A suggestion has a violet "Sugerida" seal, in the table and in the cards, and its own "Sugeridas" tab, listed only while there is one. It is never under "Pendentes", never "Autoria a conferir" and never in a "Checar pendentes" batch, and it cannot be copied with attribution. The authorship switch in the drawer says the structure suggested it and that it must be checked with the source. Once a person confirms the author, it is a quote like any other: it waits for its fact check under "Pendentes", and it can become curated.
- **Fact check.** The automatic check after a text covers only the citations the text quotes (`editorial-worker.ts`). A suggestion is checked only when someone asks for it ("Checar"); see `docs/FACT_CHECK.md`.
- **Recording date.** A card shows the recording date only when the source has one. It never shows the day the text was written, and saving a quote without a date stores none. A quote from an undated source saved in Citações before this change may still store the day it was saved as its recording date, because the old card filled the date in; it cannot be told from a date an editor typed, which is often the same day in event coverage, so it is not cleared automatically. Emptying the date and saving removes it.

A recording without speaker labels gives no curated quotes and no suggestions, because its lines have no linked speaker (`locateCitation`).

## Validation

- **Unit tests:**
  - `src/domain/formats.test.ts`;
  - `src/domain/grounding.test.ts`;
  - the funnel and preset 3.0 tests in `src/domain/pipeline.test.ts`;
  - `src/domain/pipeline-preset.test.ts` and `src/features/pipeline/preset-upgrade-model.test.ts` (the upgrade and its diff);
  - `src/domain/evidence-hints.test.ts`, `src/domain/citation-suggestions.test.ts` and `src/features/hard-news/quotes/quote-model.test.ts`;
  - `src/domain/hard-news-lint.test.ts`, the hard-news rules measured in a written text, with a relative date flagged in the headline as well as in the body. "marca" as a noun ("marca própria", "a marca", "marca de pescado") is not a soft verb. The body's "hoje" stays uncounted, because the lint cannot tell "today" from "nowadays", although the prompts ask for "atualmente". The lint is a rehearsal metric, not a studio check;
  - `src/registries/sizing-formats.test.ts`;
  - the format cases in `src/features/new-production/form.test.ts`.
- **Backend:**
  - `tests/event-formats.test.ts` covers revision on invented terms, the last resort, repeated quotes and facts, the unchanged article flow, the linha fina contract and saved funnels;
  - `tests/citation-registry.test.ts` checks that a quote of a text replaces an untouched suggestion in the list.
- **Smoke:**
  - `e2e/new-production-editor.spec.ts` chooses Cobertura de estande and checks that format, size and event reach generation;
  - `e2e/pipeline-management.spec.ts` applies 3.0 over an untouched revision 1;
  - `e2e/quote-bank.spec.ts` checks a suggestion on Citações and the recording date.
- **Live rehearsal** on 2026-10-19, with the production text model (OpenAI gpt-6-astra) on real event material. It ran the worker's draft path in memory: outline with linha fina, quote curation, part-by-part writing, grounding and the format gate. The table shows the second round, after the fixes found in the first.

| Case | Material | Body | Literal quotes | Terms without source | Time |
|---|---|---|---|---|---|
| Cobertura de estande · Completo | Hecke interview, APAS Show 2026 | 2,301 | 5 | 0 | 49 s |
| Cobertura de painel · Padrão | ApexBrasil panel, IFC Brasil 2026 | 2,943 | 6 | 0 | 57 s |
| Nota curta | SSLA 2026 press release | 906 | 0 | 0 | 21 s |
| Premiação | Personalidades da Aquicultura, Aquishow 2026 | 832–1,407 | 0 | 0 | 27–33 s |
| Abertura | Aquishow 2026 opening speeches | 2,893 | 5 | 0 | 37 s |

The first round found five problems, each fixed and covered by a test:

- a repeated quotation, fact or introduction;
- the closing verb on a paraphrase;
- the event address in the lede;
- the outline checked against the article's section range;
- speaker labels missing from the known facts.

A provider glitch (a word in another script) led to the foreign-script rule in grounding. Groq's free tier (8,000 tokens a minute) makes a format text take several minutes. The worker waits and resumes from its cache, but production writes with OpenAI.
