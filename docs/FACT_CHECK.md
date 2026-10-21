# Fact check of citations

Fidelity and veracity are separate questions. Fidelity asks whether the person said it: the literal transcript match in `src/domain/citation-library.ts` and `quotes.ts` already answers that. Veracity asks whether what they said is true. The fact check answers that with web evidence from [Tavily](https://docs.tavily.com). The words of a quote never change; the check only informs.

## Claims and verdicts

A check splits the quote into at most six claims, and gives each one a kind:

| Kind | Meaning | Searched |
|---|---|---|
| `fact` (Fato) | A verifiable statement about the world: a figure, an event, a comparison | Yes |
| `declared` (Dado declarado) | A figure or fact about the speaker's own company or institution | Yes |
| `opinion` (Opinião) | An assessment, a judgement, a recommendation | No |
| `forecast` (Previsão) | A forecast, a plan or a promise | No |

At most three checkable claims are searched, at one Tavily credit each. Each checkable claim ends with one verdict:

| Verdict | When | What is shown |
|---|---|---|
| `validated` (Validado) | A returned source confirms the claim | The source: site, title, excerpt, date and link |
| `disputed` (Contestado) | A returned source contradicts the claim | The contradicting source |
| `not_validated` (Não validado) | No source confirms or contradicts the claim | No source. This does not mean the claim is false |

The quote's seal is the worst verdict of its checkable claims, in the order disputed, not validated, validated. A quote with no checkable claim is `not_checkable`. A quote that was never checked is `pending`.

## Pipeline

`src/server/fact-check-pipeline.ts` runs three steps:

1. **Extraction.** The model typed in the pipeline's quote-selection step (`steps.quotes.model`) extracts the claims and their kinds. It also writes a neutral search query per checkable claim and rates the quote's editorial strength from 1 to 5. A neutral query looks for "maiores exportadores de camarão do mundo ranking", never for the claim itself, so the search can find contradicting sources too.
2. **Search.** One Tavily search runs per checkable claim, in parallel, using the basic depth, five results, two excerpts per source, Brazil as the preferred country, and social networks excluded.
3. **Judgement.** The same model decides each claim using only the numbered excerpts, and cites excerpt numbers, never URLs.

`settleClaim` in `src/domain/fact-check.ts` keeps only sources that the search returned for that claim. A validated or disputed verdict without such a source becomes not validated. Nothing is validated from the model's memory, and no link is invented.

The prompts were calibrated on 2026-10-20 with real seafood claims, on `openai/gpt-4.1` and `openai/gpt-6-astra`:

- "O Brasil importa o salmão do Chile" and "a tilápia é mais de 60% da piscicultura" came back validated, with sources from Valor and the PEIXE BR yearbook.
- "O Brasil é o maior exportador de camarão" came back disputed, with Seafood Brasil and BASF naming Ecuador.
- A company's own export figure came back not validated.

## Score

The score runs from 0 to 100 and is shown with its parts (`citationScore`):

| Part | Points | Rule |
|---|---|---|
| Veracity | 40 | Validated claims count 1, not validated 0.5, disputed 0. A quote made only of opinions and forecasts gets the full 40 |
| Editorial strength | 20 | The model's 1–5 rating |
| Attribution and source | 20 | Author confirmed 10, programme named 4, date 3, link 3 |
| Usage | 20 | Productions that used the quote, saturating at 5 |

A disputed claim caps the score at 30, so a popular but disputed quote never ranks among the best. The score exists only after a check.

## Storage

- **Fact checks.** Each check is a `fact_check` editorial item keyed by the citation id: the hash of the words and the source version. One check therefore serves every article that uses the quote.
- **Migration.** Migration `023-fact-check.sql` adds the item kind and the background queue.
- **Rechecks.** A recheck keeps the editor's decisions on claims whose text did not change, and keeps the ten previous seals.
- **Editor decisions.** An editor's verdict (`overrides`) prevails, and records its reason, author and date.
- **Usage.** The registry counts usage from article drafts and versions, as one use per production.

## When it runs

- **On demand.** On the Citações page, "Checar" checks one quote. A recheck of a quote that was already checked runs again. "Checar pendentes" checks up to 20 quotes one after the other and stops at the first refusal, such as exhausted credits. A suggested citation ("Sugerida", an outline passage the text did not quote) stays out of "Pendentes" and of that batch until a person confirms its author; "Checar" still checks it on request.
- **After generation.** When an article or event text is generated, the worker queues the check of up to 8 of the citations the text quotes on the completed run (`job.factCheck`), alongside the optional images. The suggested citations saved with them are not queued. `fact-check-worker.ts` claims the run with its own lease (`reporter_ed_fact_check_claim`). It skips citations that are already checked and saves each result as it settles. A missing key, a refused key or exhausted credits fail the task without retries. The text never waits.
- **In the studio.** The Checagem shows "Veracidade das falas". A disputed quotation, or one that no source validated, is a warning that points to the quotation and never blocks sending: the editor decides whether to add context or a counterpoint, or to use another quote.

## Configuration and cost

`TAVILY_API_KEY` stays on the server: in `.env.local`, in the Vercel app (Francal workspace), and in the GitHub `staging` and `production` environments, from which the release injects it into the Neon worker. The key is optional: without it the deployment still succeeds, the worker queues no check, "Checar" says the key is missing, and the app health reports `optional.tavily: false`. With it, the release authenticates the key through Tavily's `/usage` endpoint, which runs no search. A key added later reaches the app at its next Vercel deployment and the worker at its next release.

A check costs at most 3 Tavily credits and 2 model calls. The free plan's 1,000 credits a month cover about 330 quotes.
