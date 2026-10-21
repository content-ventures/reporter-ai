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
- **One speaker, no labels (stand only).** A stand recording transcribed without speaker labels, with a single confirmed person in the Material, is that person's interview: the stand funnel attributes the answers to them, and the interviewer's questions are never quoted. Panels, openings and awards have several voices, so an unlabeled line there keeps no name.
- **Stand news, as the source says it.** The stand funnel puts the company's novelty (a product, launch, service, partnership, investment, market or number) in the title and the lead. It writes "lança" or "estreia" only when the source calls it a launch, a debut or a novelty; otherwise it writes "apresenta".
- **Self-claims only attributed.** What a company or person says of itself ("único", "pioneiro", "primeiro", "líder", "referência", "carro-chefe") appears only inside quotes or attributed ("que a empresa diz ser o único do mercado"). It never appears in the newsroom's voice or in the title, and it never replaces the fact.
- **The event's name.** Every funnel names the event as `event.name` writes it, because transcriptions misspell proper names.

## Prompts

Each format has a funnel with four prompts in `PipelineDefinition.funnels`: structure (title, linha fina, intertítulos), evidence curation ("Evidências"), opening and parts. The defaults are in `src/domain/format-prompts.ts`.

Every format is written as hard news (notícia). The shared `HARD_NEWS` block is in every structure, opening and part prompt:

- **Lead.** The first sentence is the news: who, what, when and where, in 40 words or fewer, with no quote. It never opens with the event, the ceremony, the programme, the theme, someone's presence or a scene. How or why comes in the second sentence.
- **Inverted pyramid.** Parts go from the most to the least important. The last part ends on its last relevant fact, with no recap, moral or forced closing quote.
- **Headline.** The fact, with a concrete verb in the present tense, a number when there is one, and 90 characters at most. It never uses destaca, aposta em, reforça, discute, debate, marca, leva, traz or foca em.
- **Attribution and tone.** Disse, afirmou, informou, segundo or de acordo com, never ressalta, avalia, pontua or destaca. No promotional adjective outside quotes, and never "Confira".
- **Quotes.** Short: one idea in one or two sentences. A section carries one literal quote whenever its evidence holds a quotable line: an identified speaker, never the interviewer, four words or more. Awards sections are lists of winners with no quotes.

The opening selects up to four evidence ids, so the lead's fact can come with every sentence of the quote that supports it. The limit is the same in the outline and curation schemas (`pipeline.ts`, `editorial-outline.ts`, `pipeline-output.ts`).

A format job curates its evidence with the funnel's own Evidências prompt, which keeps the format's quote minimum (`sizing.minQuotes`), its opening ids and its rule on quotes. The workspace's shared quotes step is now the article's only. Curation still runs only when "Selecionar evidências antes da redação" (`curateQuotes`) is on.

The Prompts page lists them under "Funil · …" and versions them with the rest. Workspaces saved before the funnels, or before the curation prompt, get the defaults through `withFormatFunnels`. Only the funnel steps someone edited are stored, so untouched funnels follow the code defaults. Their article prompts are never changed. The funnels use the model of the workspace's writing step.

A format job writes part by part (`formatPipelineDefinition`). It reuses the measured budget, literal-quote and revision mechanics of the article.

## Validation

- **Unit tests:**
  - `src/domain/formats.test.ts`;
  - `src/domain/grounding.test.ts`;
  - the funnel tests in `src/domain/pipeline.test.ts`;
  - `src/registries/sizing-formats.test.ts`;
  - the format cases in `src/features/new-production/form.test.ts`.
- **Backend:** `tests/event-formats.test.ts` covers revision on invented terms, the last resort, repeated quotes and facts, the unchanged article flow, the linha fina contract and saved funnels.
- **Smoke:** `e2e/new-production-editor.spec.ts` chooses Cobertura de estande and checks that format, size and event reach generation.
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
