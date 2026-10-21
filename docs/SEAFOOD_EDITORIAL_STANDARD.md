# Seafood editorial map and writing guide

This specification defines the proposed Seafood Brasil configuration for producing publishable sector journalism from **Conteúdo**: recordings, transcripts, written material, documents, URLs, or combinations of them. The reader supplies available content without following a mandatory briefing template. Reporter IA organizes that content internally and preserves its sources.

The shared editorial map controls coverage and relevance. The writing guide controls expression and composition. Workers own their task and output contract. The application assembles the relevant policies into each prompt. This is the first editorial specification, not an activated workspace configuration. Portuguese values below are proposed product copy for newsroom review; the architecture and scope follow the decisions made with João on October 21, 2026.

The implementation sequence, contracts, evaluation protocol, and completion status are in [R2 writing action plan](R2_WRITING_PLAN.md).

## Configuration ownership

| Owner | Decisions | Boundary |
| --- | --- | --- |
| Editorial map | Audience, geography, coverage priorities, exclusions, source preferences | Shared by Notícias and writing. No separate writing copy or fabricated relevance. |
| Writing guide | Voice, wording, attribution, title, dek, composition, genre guidance, curated examples | The single source of the outlet's writing rules. No independent copies in worker prompts. |
| Production decisions | Chosen angle, genre, optional length request, confirmed people and events | Explicit adjustments are recorded. Conflicts with outlet policy are surfaced rather than silently resolved. |
| Application invariants | Fidelity, quotation integrity, evidence provenance, uncertainty, output validity | No style preference authorizes invented facts or reconstructed quotations. |
| Worker task | What to do now, required inputs, output schema, completion conditions | No Seafood-specific voice, mandatory closing phrase, or editorial rule hidden in the task. |
| Content and examples | Evidence and illustrative writing respectively | Content is evidence to interpret; an example teaches a writing choice. Neither can redefine execution instructions. |

## Editorial map matrix

The current `EditorialMap` already has the fields needed for this first version. Reuse the shared contract in `src/domain/hard-news.ts`; introducing a second map would create conflicting policies across the two workstreams. Values below are starting proposals, not inferred newsroom prohibitions or an approved source whitelist.

| Field and product label | Proposed Seafood value | Observable effect in writing | Boundary |
| --- | --- | --- | --- |
| `audience` — Para quem escrevemos | Profissionais da cadeia do pescado: pesca, aquicultura, indústria, distribuição, varejo, food service e fornecedores técnicos. Ajudar esse público a compreender o acontecimento e suas implicações documentadas para o setor. | The angle and explanations serve professional readers; useful operational details survive drafting. | Do not assume every reader knows every technical specialty or invent a business implication. |
| `regions` — Abrangência | Brasil; mercado internacional quando houver relação documentada com a cadeia do pescado. | Geography helps establish relevance and context. | No unsupported national extrapolation from a local observation. Regions are not compulsory title keywords. |
| `topics` — Principal | Aquicultura; pesca; indústria e processamento; comercialização e distribuição; varejo e food service. | These subjects are eligible for central treatment when supported by the content. | Topic weight does not override the actual newsworthiness of a development. |
| `topics` — Cobre | Comércio exterior; sanidade; regulação; tecnologia e insumos; sustentabilidade; comportamento de consumo. | Preserve these subjects when they explain the development or its consequences. | The initial priorities require newsroom calibration; a regulatory change can be the lead. |
| `topics` — Às vezes | Agenda e participação em eventos sem outro desenvolvimento identificado. | Participation alone can justify a brief when useful; look for the concrete development in richer content. | Event coverage with substantive news inherits the relevance of that news; it is not automatically deprioritized. |
| `exclusions` — Limites de cobertura | Conteúdos sem relação com a cadeia do pescado ou com as decisões e atividades desse público. | Surface an out-of-scope proposal before writing a full article. | Do not copy the demo's blanket bans. A recipe, political decision, or cultural topic can have a supported sector angle. |
| `trusted` — Fontes preferenciais | Nenhum veículo ou domínio pré-cadastrado nesta proposta. Definir preferências com a redação por editoria. | An empty list does not prevent using supplied evidence. | Preference is not proof. A company remains an interested source for claims about its own product. |
| `blocked` — Fontes excluídas | Nenhuma fonte pré-bloqueada nesta proposta. | No silent rejection based on fictional demo sources. | Preserve the provenance of supplied content even if its use is later restricted. |
| `version`, `updatedAt`, `updatedBy` | Gerados pelo sistema ao salvar uma versão. | Identify which map governed an article. | Never invent an approver, timestamp, or active version. |

The reader relevance question derived from this map is: **“Qual informação deste conteúdo ajuda o profissional da cadeia do pescado a entender uma mudança, uma decisão, uma operação ou um problema concreto?”** Its answer must cite content evidence. It is a planning criterion, not a sentence to insert into every article.

## Writing guide matrix

Preserve existing fields and add explicit composition fields only where they help editing, validation, and stage selection. Do not keep a second copy of the same rule inside `rules`. Stable rule IDs connect configuration, prompt composition, review findings, and tests.

| Rule ID | Field and contract status | Proposed Portuguese value | Observable acceptance |
| --- | --- | --- | --- |
| `voice` | `voice`, existing | Jornalístico, direto, informado e acessível. Use ações concretas e detalhes relevantes. No discurso indireto, transforme a oralidade em explicação clara, preservando autoria, causalidade, intensidade e ressalvas. Não transporte imagens orais pouco claras para a narração. Dentro das aspas, preserve o texto original; não amplie termos técnicos por plausibilidade. | Specific subjects and actions replace generic sector commentary; the article does not adopt the source's promotional voice. |
| `headline` | `headline`, existing | Expresse o desenvolvimento principal sustentado pelo conteúdo e organize os complementos em torno dele. Preserve a diferença entre apresentação, lançamento, intenção, projeção e resultado. O tempo verbal deve respeitar o momento documentado do acontecimento; a data da geração não atualiza a notícia. | The title's promise is supported by the body and source. No universal present-tense or company-plus-event formula. |
| `dek` | `dek`, implemented | Acrescente um complemento central ao título em uma frase concisa, sem enumerar os assuntos do corpo. Se houver dois complementos independentes, escolha o que melhor desenvolve o recorte e leve o outro ao texto. Título, linha fina e abertura devem orientar a mesma leitura. Preserve autoria, ressalvas e referência temporal: uma avaliação na entrevista não comprova a situação atual. Não invente a data ausente. | The line adds information rather than repeating the title with synonyms or enumerating the entire article. It never describes the recording or generation process. |
| `lead` | `lead`, existing | Abra pela ação concreta e apenas pelo contexto necessário para compreendê-la. Desenvolva cedo o que justifica título e linha fina, antes de histórico, elogios ou intenções genéricas. A menção a local ou destino não exige uma avaliação ampla de sua importância: retenha o detalhe que explica concretamente a ação. Uma cobertura de evento pode reunir produto, discussão técnica e mercado, com prioridade clara e desdobramentos conectados. | No generic industry introduction, compulsory list of all reporting questions, or fixed two-paragraph opening. Institutional context must explain the development rather than delay it. |
| `attribution` | `attribution`, existing | Identifique a origem de dados, avaliações e declarações. Apresente nome, cargo e organização quando confirmados e relevantes. Mantenha clara a autoria ao longo do parágrafo; retome a fonte quando houver mudança, ambiguidade ou nova afirmação que precise de atribuição, evitando reapresentá-la em cada frase. Não transforme uma avaliação em afirmação do veículo nem complete identificação por plausibilidade. | Speaker identity, source, time, and qualifiers remain correct. Missing roles or surnames are not completed by plausibility. |
| `quotations` | `rules` with stable ID, existing storage | Use falas que acrescentem explicação, posição ou detalhe relevante. Prefira discurso indireto para apresentar ações como participar de uma palestra, preservando seu conteúdo substantivo. Se citar, escolha um excerto contíguo útil e literal, sem retirar autoria, negação, condições ou incerteza. Não reconstrua uma fala mais elegante dentro das aspas. | Every quotation has an original passage and an identified speaker when attributed. No editorial quota or required long quote. The introduction must not retell the quotation. |
| `paragraphs` | `composition.paragraphs`, implemented | Cada parágrafo acrescenta fato, explicação ou consequência relevante ao recorte. Contexto institucional ou regional entra quando explica concretamente a ação, o público atendido ou uma condição da notícia. Faça o teste de retirada: se a frase só acrescenta avaliação genérica de relevância, evolução, satisfação ou cumprimento de objetivos, corte-a e preserve o dado específico que ajuda a compreender o desenvolvimento. Conecte informação, explicação e consequência; integre frases isoladas quando isso melhora a leitura. Corte repetições de significado e antecipações do que a fala seguinte informa. Preserve fatos essenciais, finalidades, causas, condições, prazos, atribuição e grau de certeza ao condensar ou mover trechos. A extensão acompanha a informação disponível, sem meta de corte nem preenchimento. | No repetitive paraphrase-plus-quote units, forced equal-length blocks, or arbitrary breaks that detach attribution. Removing filler must not remove substantive information. |
| `headings` | `composition.headings`, implemented | Use intertítulos para mudanças relevantes de assunto, respeitando o formato e a estrutura confirmados na pauta. Uma seção curta não exige divisão apenas para parecer completa; quando o formato permitir, pode integrar o desenvolvimento anterior. Não imponha quantidade universal de seções. H2 é a divisão normal; H3 exige subordinação real. | No compulsory number or interval of headings. H2 is the normal body division; H3 only for a real subordinate section. |
| `emphasis` | `composition.emphasis`, proposed | Use destaques de forma seletiva, quando houver função editorial aprovada. Não aplique negrito automaticamente a todas as aspas, marcas ou palavras-chave. | Ordinary quotations remain integrated into the text. Existing manual formatting is not silently stripped. |
| `lists` | `composition.lists`, proposed | Use listas quando itens paralelos forem mais claros nesse formato. Prefira texto corrido quando houver progressão narrativa ou explicação conectada. | Actual list blocks when a list is intended. No mandatory bullets or character prefixes standing in for structure. |
| `closing` | `composition.closing`, implemented | Encerre com a última informação relevante ou uma declaração que acrescente conteúdo. Preserve condições e horizontes de uma previsão, sem anunciar a operação editorial com expressões como “manteve a ressalva”. Não acrescente balanço genérico, conclusão promocional ou recapitulação. Mantenha a referência temporal do relato também nas transições e na última frase; o presente não deve atualizar uma avaliação feita no evento. | No compulsory quotation, “finalizou”, optimistic forecast, recap, or moral of the story. |
| `length` | `composition.length`, proposed | A extensão acompanha a quantidade de informação relevante disponível e o formato escolhido. Um pedido de tamanho orienta a edição, sem autorizar repetição ou preenchimento. | Sparse content can produce a short article. A hard delivery limit cannot silently remove an essential qualifier. |
| `links` | `composition.links`, proposed | Insira links úteis e verificados quando sustentarem uma informação ou oferecerem contexto pertinente. Preserve a origem e a data dos materiais consultados. | No invented URLs, keyword-link quotas, or automatic use of archive content as current evidence. |
| `figures` | `composition.figures`, proposed | Use imagens pertinentes com legenda e crédito confirmados. Registre separadamente qualquer pendência de direitos ou identificação. | Image, caption, credit, and alt remain distinct document data. No caption asserts unverified people, places, or events. |
| `terminology` | `terms` plus a contextual rule, existing | Preserve nomes, marcas, espécies, unidades e termos técnicos confirmados. Explique termos menos familiares quando necessário. Sinalize dúvidas de transcrição. | Consistent terminology without guessing names or replacing technically distinct terms. |
| `numbers` | `rules` with stable ID, existing | Preserve unidade, período, base de comparação e grau de certeza dos números. Na narração, use formas como R$ 18 milhões e 30%, quando sustentadas pela fonte. | The same digits elsewhere in a source are insufficient evidence for a claim. Values are not rounded or converted silently. |
| `process_notes` | `rules` with stable ID, existing | Mantenha dúvidas de transcrição, identificação e apuração fora do texto publicável. Encaminhe-as ao jornalista com o trecho de origem. | No “sem identificação na transcrição” filler. If identity is essential, the article retains a reporting issue rather than a fabricated attribution. |
| `genre` | `genreProfiles`, proposed | Adapte a composição ao gênero e à informação disponível, mantendo as mesmas regras de fidelidade e voz. | A stand report does not impose its structure on a market report, technical article, panel, award list, or brief. |
| `examples` | `examples`, existing; snapshot metadata proposed | Use exemplos reais e comentados para orientar escolhas de escrita. Os fatos desses exemplos não pertencem à nova matéria. | The model receives the selected, versioned excerpts and their explanation; a URL alone is not treated as retrieved content. |

Suggested contextual terminology entries: `alavancar` → `aumentar`, when that is the intended meaning; `players` → `empresas`, when referring to companies. These are narration preferences, not blind replacements inside quotations, proper names, links, or technical expressions. Do not import the demo's replacements of `pescados` or `piscicultura de tilápias` as universal corrections.

The eight refined values for voice, title, dek, lead, attribution, paragraphs, headings and closing are offered through **Revisar sugestões** in the guide screen. Their exact implementation is `src/domain/writing-guide-suggestions.ts`. They are applied only to the user's draft after a before/after preview, remain editable, and affect runs only after the guide is saved. Existing configurations are never replaced on load. No change to the editorial map was justified by this refinement: its audience and scope already support company/event coverage with technical and market developments.

The October 21 preservation pilot exposed three calibration requirements. First, essential facts are the information whose removal distorts the selected angle or loses a central action, purpose, consequence or condition; generic corporate praise must not become compulsory prose. Second, uncertainty is checked across the entire source, including secondary facts: a categorical repetition in the next segment does not by itself resolve an earlier qualifier. Third, the review must explain hierarchy, economy, quotation usefulness, language and certainty separately, with article passages and actionable findings. Those dimensions organize the inspection; the saved map and guide remain the editorial authority.

## Genre profiles

| Profile | Editorial emphasis | Structure flexibility |
| --- | --- | --- |
| Sector hard news | The development, its timing, parties, supported scope, and relevant implications | Lead with the development. Attribute announcements and distinguish plans from completed actions. |
| Event company coverage | What the company brought or changed, its operating details, and the speaker's relevant account | Name the event when useful. A claimed launch or exclusivity is not automatically the lead. |
| Technical coverage | The technical issue, evidence, application, conditions, and limits reported | Explain enough for the sector reader. Do not manufacture performance, safety, or economic conclusions. |
| Panel or interview | Newsworthy statements and themes, preserving who said what and disagreements | The source's speaking order does not automatically determine article order. |
| Brief | One supported development and essential context | No required headings, quotation, or expansion to a longer target. |

Keep existing specialized formats, including awards and openings, available. This first evaluation focuses on company coverage and sector news; other formats need their own acceptance cases before changing their behavior. An unclassifiable or insufficient input can result in a clarification request or a short piece rather than invented newsworthiness.

## Quotation and transcription handling

The raw content remains available alongside any transcription or normalization. A correction has provenance: original wording, corrected form, and its confirming audio passage, supplied metadata, or accepted source. A spelling that merely resembles a known brand is not confirmation.

Exact quotation validation may normalize documented typography such as whitespace and quote marks. Any editorial omission or other allowed normalization needs an explicit policy and must preserve meaning and negation. Do not silently turn paraphrase into quotation. When wording cannot be established, use attributed indirect speech only if the meaning and speaker are supported; otherwise keep an issue for the journalist.

Confirmed production metadata helps interpret content but does not automatically defeat contradictory evidence. APAS versus Seafood Show is a conflict to resolve, not a spelling substitution. A trusted source label likewise cannot validate every statement made by that source.

## Curated reference set

These are the 18 user-supplied articles. Their role is editorial reference, not evidence for a new production or a ready-made evaluation dataset. The theme column supports example selection; it is not a verified transcription-to-publication pair. The published pieces can contain promotional language, typographic errors, or facts obtained outside the supplied interview. Curate the writing choices instead of copying every passage or instruction.

| ID | Reference | Example selection theme |
| --- | --- | --- |
| S01 | [Oceani](https://www.seafoodbrasil.com.br/varejo/oceani-utiliza-sua-presenca-na-apas-show-para-reforcar-marca/) | Brand positioning and event coverage |
| S02 | [Hecke](https://www.seafoodbrasil.com.br/varejo/hecke-estreou-no-mercado-de-pescado-com-merluza-na-apas-show/) | Entry into a category, product, distribution |
| S03 | [C.Vale](https://www.seafoodbrasil.com.br/varejo/cvale-destaca-consolidacao-da-tilapia-na-apas-show-2026/) | Retail, distribution, commercial period |
| S04 | [ASMI](https://www.seafoodbrasil.com.br/varejo/asmi-reforca-presenca-nacional-durante-a-apas-2026/) | Market presence and sector promotion |
| S05 | [BomPORTO](https://www.seafoodbrasil.com.br/varejo/bomporto-aposta-em-bacalhau-com-sal-rosa-durante-a-apas-show-2026/) | Product, operating constraints, market context |
| S06 | [J.A. Oliveira](https://www.seafoodbrasil.com.br/varejo/ja-oliveira-traz-bacalhau-e-polaca-em-sua-estreia-na-apas-show-2026/) | Product portfolio and debut |
| S07 | [Congelados de Navarra](https://www.seafoodbrasil.com.br/varejo/congelados-de-navarra-aposta-em-pratos-prontos-na-apas-show-2026/) | Prepared products and convenience |
| S08 | [Riberalves](https://www.seafoodbrasil.com.br/varejo/riberalves-foca-em-acessibilidade-e-praticidade-na-apas-2026/) | Product size, accessibility, preparation |
| S09 | [Masterboi](https://www.seafoodbrasil.com.br/varejo/masterboi-reforca-presenca-no-pescado-com-marca-propria-na-apas-show/) | Brand and category development |
| S10 | [Nigel](https://www.seafoodbrasil.com.br/varejo/nigel-estreia-na-apas-show-2026-com-foco-no-pescado-portugues/) | Origin and market entry |
| S11 | [Easychef](https://www.seafoodbrasil.com.br/varejo/easychef-estreia-no-pescado-e-leva-panga-e-polaca-para-a-apas-2026/) | Species, portfolio, debut |
| S12 | [Guabi](https://www.seafoodbrasil.com.br/aquicultura/guabi-foca-em-manejo-nutricional-preventivo-na-aquishow-2026/) | Nutrition and preventive management |
| S13 | [MSD Saúde Animal](https://www.seafoodbrasil.com.br/aquicultura/msd-saude-animal-destacou-sanidade-e-vacinas-na-aquishow/) | Product, technical discussion, economic outlook |
| S14 | [Qualis](https://www.seafoodbrasil.com.br/aquicultura/qualis-nutricao-animal-estreou-na-aquishow-com-foco-nacional/) | Nutrition and expansion |
| S15 | [MAP Acqua](https://www.seafoodbrasil.com.br/aquicultura/map-acqua-destacou-biosseguranca-e-automacao-na-aquishow-brasil-2026/) | Biosecurity and automation |
| S16 | [Real Fish](https://www.seafoodbrasil.com.br/aquicultura/genetica-e-qualidade-da-agua-foram-destaques-da-real-fish-na-aquishow/) | Genetics and water quality |
| S17 | [Imeve](https://www.seafoodbrasil.com.br/aquicultura/imeve-destaca-biosseguridade-e-prevencao-na-aquishow-brasil/) | Biosecurity and prevention |
| S18 | [Raguife](https://www.seafoodbrasil.com.br/aquicultura/raguife-focou-em-nutricao-e-expansao-fabril-durante-a-aquishow-brasil/) | Nutrition and industrial expansion |

Initial annotation examples:

- **S02:** the article connects category entry with the product choice and distribution constraints. Teach the connection between a development and documented operating detail; do not transfer the product facts to another company or adopt the source's praise as the narrator's judgment.
- **S13:** the article preserves the sanitary-cost discussion alongside the vaccine and market outlook. Teach completeness of the selected angle; an attractive forecast should not displace the technical substance.
- **S03:** the piece relates retail distribution to the reported seasonal commercial result. Teach temporal and source attribution; a speaker's commercial assessment does not establish independently measured national performance.
- **S08:** product size and preparation provide a concrete way to explain accessibility and convenience. Teach specificity; preserve whether the benefit is a company's claim or otherwise evidenced.

Store each selected excerpt with its reference ID, genre, URL, retrieval date, source version or hash, and annotation. Initial implementation may include a small curated set per genre. Selection must be logged and must not silently change when a remote article is updated. Full copyrighted articles need not be copied into this repository to define the policy.

## Rules proposed for the first migration

Replace the blanket all-quotation bolding with the guide's emphasis policy. Add the dek to review and final-reading surfaces. Make title, dek, body, figures, and any service box consistent across approval and delivery. Preserve already approved versions and deliberate manual edits.

Retire conflicting house-style instructions from legacy format prompts only when the corresponding guide rule is wired into both writing and review. Remove universal claims of novelty, fixed opening counts, and mandatory closing phrases from the new path. Keep factual checks and existing specialist flows until their replacements pass the scoped acceptance cases.

The existing preview seeds in `src/features/hard-news/preview/news.ts` include fictional outlets and example domains. They are demonstration data, not the Seafood preset or a source of production trust rules. No preview seed should be promoted to production as part of the migration.
