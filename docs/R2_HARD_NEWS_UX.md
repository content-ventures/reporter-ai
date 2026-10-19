# R2 · Hard News — UI/UX preview

The R2 experience (F2.1–F2.13) runs on top of the R1 product, behind the release gate. In an R1 build (production) the R2 screens are a demonstration on their own routes; the R1 stages do not change.

## Preview

```sh
NEXT_PUBLIC_REPORTER_E2E_FIXTURES=true NEXT_PUBLIC_REPORTER_PREVIEW_RELEASE=R2 pnpm exec next dev --port 3100
```

`CURRENT_RELEASE` becomes `R2` only when both variables are set (simulated fixtures workspace). The connected build always shows R1. `/?reset=1` restarts both the workspace and the desk.

The R2 screens with no backend yet carry an amber "Demo" Badge in the top bar, in both builds: Notícias and Fontes, Apuração, Acervo, Mapa editorial, Guia de escrita and Integrações (catalog, each app, WordPress). Imagens (bank and photo page) and Citações carry it only without the R1 visual and citation libraries (the fixtures builds): the connected build reads and saves real data there. Screens on real data do not carry it: Modelos and the R1 stages. The list is `isR2DemoPath` in `ui/r2-preview.ts`. In an R2 build, inside the R1 screens, each simulated R2 block carries the same word in its header (`DemoBadge`, `hard-news/demo-badge.tsx`): Início's "Pauta do dia", the Apuração lane in Produções, the studio's Fontes, Evidências and Do acervo, and the Entrega's Portal.

## In an R1 build (demonstration)

Production is an R1 build. `HARD_NEWS_DEMO` (`ui/r2-preview.ts`) is true there, and:
- the menu is the R2 one: Início, Notícias, Produções; Biblioteca (Modelos, Imagens, Citações, Acervo); Configurações (Mapa editorial, Guia de escrita, Integrações);
- the R2 routes render the R2 screens, on the desk kept in this browser; `/news/draft` and the first review URL (`/prototypes/r2?screen=`) open the matching destination; Apuração (`/productions/{id}/research`) stays 404;
- the desk writes nothing to the workspace: no example productions are seeded and **Cobrir** is disabled ("Na demonstração, Cobrir não abre pauta.");
- the R1 stages see no desk (`useOptionalHardNews` returns `null` in the demonstration), so Início, Produções, the studios, the review and the Entrega are R1 as they were;
- Imagens and Citações read the R1 libraries in the connected build, and "Usar em artigo" places a photo in a real article, as in R2;
- Modelos is the gallery below, on the workspace's own models.

`e2e/hard-news-demo.spec.ts` (connected smoke) opens every demonstration screen at 1440 and 390 px and checks that no API request writes.

## Journey

1. **Notícias** (`/news`, F2.1, F2.2, F2.4) is a live **radar** the desk keeps open. The header says "Ao vivo · Lido há 1 min". The board fills the frame, top to bottom:
   - **Sinais do radar** (strip): Novas since the last look, Prioridade alta (warns when one waits more than 2 h), Pautas de hoje against the goal (REQ-2.2, click to adjust) and Fontes (links to the sources).
   - **Cobrir agora**: the high-priority stories as cards (outlet, headline, the AI's one-line why, score, topic, how many outlets ran it and how many joined in the last hour). Three cards from 1600 px, two below, one on a phone.
   - **Na fila**: everything else, grouped by arrival ("Novas desde 14:20", Última hora, Hoje, Ontem, Anteriores), with the AI's priority as dot + word, and "Marcar como vistas".
   - Beside it, **Chegadas** (arrivals per hour over 12 h, by priority) and **Fontes** (each feed's health, the failing one first with "Tentar de novo").
   - Tabs **Para decidir** / **Decididas** (covered, postponed with "Volta em 12 h", discarded with the reason) and a search.

   The open story sits beside the board (the ficha): the lead, **Leitura da IA** (score dial, reasons, "Sua avaliação" correction kept for calibration), **Quem publicou** (every outlet, oldest first) and the original text on demand. The open story is explicit: nothing that arrives replaces it. The decisions are **Cobrir**, **Adiar** and **Descartar** (with a reason). Shortcuts: J/K to move, C to cover, A to postpone until tomorrow. "Colar link" imports one URL; **Fontes** (`/news/sources`) manages the RSS feeds. At 1024 px or less the board and the story are two tabs (Radar | Notícia). `/news?item=<id>` opens one story (Início links there).
2. **Cobrir** creates a production through the existing `createBlank` command, so it appears in Produções. Research starts at once and the ficha shows it (AgentTrace) with "Abrir apuração".
3. **Apuração** (`/productions/[id]/research`, F2.6, F2.7) is a new first stage in the same production header ("Apuração · 1 de 4"). It holds:
   - the story and its angle;
   - the web-search sources (SuggestionCards: "Usar fonte" or "Descartar"), the accepted list, a manual link and "Pesquisar de novo";
   - the editable outline: headline, lead, AI keyword suggestions (REQ-2.7), and intertitles with their points and sources;
   - a side panel "Contexto" with quote-bank entries, archive matches and the writing guide.
   
   The primary action reads "Montar outline", then "Escrever artigo". Writing shows its steps (AgentTrace) and saves the draft into the R1 article through `saveDraft`.
4. **Estúdio** (the R1 studio) adds the following when the production came from the desk:
   - The panel's first tab is **Fontes** (the dossier).
   - Checagem gains **Evidências** (F2.8). Claims are lit in the text, and each one is decided by a person with Corrigir, "Manter, conferida" or "Remover frase"; the decision is kept with who and when.
   - Checagem also gains **Do acervo** (F2.13): quotes and internal links, each with its origin, inserted only on acceptance.
   - Quotations are checked against the quote bank instead of a transcript.
   - The send dialog warns about claims still to check.
5. **Aprovação** is unchanged. The confirmation says the next step is sending to the CMS.
6. **Entrega** gains **Portal** (F2.10): category, author, slug, excerpt and tags (prefilled from the keywords), then "Enviar ao CMS como rascunho" and the CMS answer (post id and link, failure with retry). A newer approved version updates the same post. "Baixar pacote" becomes secondary.
7. **Produções** gains an **Apuração** lane. Desk cards say "Notícia · <fonte>" and their desk state ("Apuração · 3 fontes aceitas", "No CMS · Rascunho").
8. **Início** gains "Pauta do dia" (registry widget `news-queue`): the same story cards as the radar, the high-priority ones first, each opening the story on the desk.

Library and settings:
- Citações (`/quotes`, F2.11, cards in pages of 12, 24 or 48). The connected build reads the R1 citations (`CitationLibrary` port, `quotes/quote-model.ts` with tests).
  - Each citation is an interview passage with speaker, program, minute and date, "Conferida" when the author is confirmed.
  - Its words, source and speaker are fixed; the context, the date and the check change.
  - "Adicionar fala" waits, with the reason ("As falas saem da transcrição de cada produção."), and the strip counts sources instead of uses.
  - Quotes from events or articles, with topic and role, have no R1 backend yet.
- Acervo (`/archive`, F2.12): the portal's published articles as a library the reporter searches before covering a story ("o que já demos sobre isso?").
  - The header counts what was published and what the AI read. One large field ("O que o portal já publicou sobre…", `/` focuses it) has suggested searches under it, offered only when the AI can answer them.
  - Enter or a suggestion runs a search. The AI's answer comes first: its steps while it reads (AgentTrace), then the text with numbered markers beside the sources it cites (article, date, address). "Nothing found" says so and that it does not prove the fact did not happen. Below the answer come the articles found, also the ones the AI has not read. Clearing the field goes back to the library.
  - Without a search, the editorias are folders: a Carousel straight on the page (no tray), each card with the editoria's photo, its name, the count and who signs it (the faces are hidden on a phone). From 1600 px every folder fits one row; narrower, the row slides (five in view, about 1.6 on a phone). A folder filters the articles; a Chip in the bar removes the filter. The tabs are Todas, Usadas pela IA and Fora da IA.
  - An article is a card with its cover, headline, editoria, date and byline, plus "Copiar link". The tag "Usada em N pautas" says the AI used it. Only exceptions carry a note under the card: "Na fila da IA" (the preview reads it a few seconds after the page opens), or "Leitura falhou" with "Reenviar para a IA".
  - The drawer shows the cover, the excerpt and the address (copy), the way into the AI (Publicada → Lida pela IA → Usada em pautas) and, under "Pautas que usaram", a way into each story's Apuração or Estúdio.
  - Uses are derived from the stories' research (attached and accepted archive sources; a discarded one is no use) and from the studio's link suggestions. The search, the shelves and the tag are in `archive/archive-model.ts`, with tests.
  - Covers: the CMS keeps each article's featured image (and each category's image), and the backend will bring them. The preview borrows fitting photos from the image bank, a different one for each editoria (`archive/archive-covers.ts`).
  - DS gap: an inline citation marker can still wrap to the next line on a phone.
- Imagens (`/images`, F2.9, credits and rights)
- Mapa editorial (`/settings/editorial-map`, F2.3) and Guia de escrita (`/settings/writing-guide`, F2.5) open on the setting in force, edited in place. There is no separate edit mode.
  - Each part is a single-column section titled with the question the desk would ask.
  - The header carries the version and who saved it, plus "Versões", a drawer with the Timeline of versions.
  - Any change brings the sticky bar ("Alterações não salvas", Descartar, Salvar versão N) and the leave guard. People without edit permission see the same page with the controls disabled.
  - Saving the map rereads the radar's waiting stories with the new version, so the radar shows what the page promised. The topic weights are Principal / Cobre / Às vezes ("Prioridade" stays for the queue's bands).
  - Mapa:
    - the strip: the radar's queue under the map on screen, with deltas while changing;
    - "Sobre o que o portal escreve?": three cards, Principal (sobem na fila), Cobre (entram na fila) and Às vezes (descem na fila). Each topic shows the stories it holds in the radar, and its menu moves or removes it. A new topic enters as Cobre;
    - "O que fica de fora?": subjects and blocked sources, with the stories they leave out now;
    - "Em quais fontes confiar?": the sources with their marks and their stories in the queue, plus a feed picker;
    - "Para quem o portal escreve?": the audience and the regions.
    - While changing, "O que muda no radar" lists the stories that change priority or leave the map. It sits at the end, by the bar, so nothing above the rule being changed moves (`settings/map-effect.ts`, with tests).
  - Guia:
    - "O guia em ação" rewrites a paragraph live (DiffView: sem o guia | com o guia), with preferred terms swapped and the phrases a banning rule quotes removed;
    - "Como a IA escreve?": voz, título, lead and atribuição, side by side. A limit the example opening breaks shows as the field's error;
    - "Que palavras a IA troca?" and "Que regras a IA segue?": each one says when it changes the example;
    - "Quais matérias servem de modelo?";
    - the versions drawer counts the articles each version wrote (`settings/guide-effect.ts`, with tests).
- Integrações (`/admin/integrations`, F2.10, admin: the app catalog, each app's connection and the webhooks)

### Imagens (image bank)

`/images` works like a stock bank (Unsplash, Pexels, Shutterstock). One search covers the portal's archive ("Acervo próprio"), Unsplash and Pexels:
- Suggested searches show under the field, with counts.
- The source tabs follow the search and filters.
- The bar has "Filtros" (orientation, color, cover size, rights), order and the Mosaico / Grade views.
- Mosaico is a four-column masonry with no text (two columns on a phone). Grade shows 4:3 tiles with one line each: the bank's or the portal's BrandMark and the credit.
- A photo that cannot go into an article (REQ-2.9: rights to confirm, no credit) carries its status. In Mosaico it is an attached note; in Grade it is the tile's line.
- The search and filters live in the address (`q`, `fonte`, `orientacao`, `cor`, `tamanho`, `direitos`, `ordem`, `vista`, `pagina`).

Each photo has its own page, `/images/[id]` (`own:img-x`, `unsplash:abc`, `pexels:123`). It shows the photo large, Autor (Avatar and profile), Direitos (license and credit), Detalhes, Temas and "Imagens parecidas". The main action follows the rights:
- a bank photo: **Salvar no acervo** (license "Banco de imagens", credit `Nome/Unsplash`, origin kept);
- an archive photo that is ready: **Usar em artigo**;
- an archive photo that is blocked: **Editar créditos**, with the reason in view.

"Usar em artigo" opens a drawer with:
- the photo, its credit and license;
- the workspace's productions in progress (R1, not archived), as a list with stage, person and time;
- "Usar como" (Capa / No texto);
- an editable caption.

"Usar imagem" waits until a production is chosen. It then puts the photo into that production's article, through R1 in the preview too:
- the photo becomes an R1 image asset of the production (credit kept, "Uso autorizado");
- the draft is saved with it as the cover ("Imagem de destaque", replacing the AI's cover suggestion) or as a figure at the end of the text, with the caption;
- the toast opens the article.

A locked article (in approval) or a draft that changed meanwhile says why and changes nothing. The desk's archive counts one more use (`images/article-image.ts`, with tests).

Preview data and limits:
- The archive seed is `seedImages()` (`preview/library.ts`): the local sample plus nine photos saved from the banks.
- The bank results are `preview/image-bank.ts`: 36 free-license photos (20 Unsplash, 16 Pexels) with real authors and profiles. They are hotlinked from the banks' CDNs, never downloaded, and answer after 350 ms so the field shows its spinner.
- On real data: the connected build reads the R1 visual library (`VisualLibrary` port), and only that build has it. The fixtures preview keeps the preview archive and banks.
  - The archive is the library's kept photos: cleared, with credit as published ("Nome/Pexels").
  - The bank tabs are the library's search in the banks that have a key, from two letters on.
  - "Salvar no acervo" is `importImage`.
  - A library photo's credit and license stay as the bank gave them, so it has no "Editar créditos".
  - A bank photo's page resolves what the search answered in this tab (`images/library-model.ts`, with tests).
- Still without a backend: "Enviar fotos" to the archive (R1 uploads go to a production), editable credit and license with "rights to confirm", and the count of uses of a library photo.
- "Enviar fotos" keeps the files in the tab's memory only (`blob:`). They enter with rights to confirm and are gone on reload.
- The pure rules (search, filters, merging, mosaic, rights, address) are in `images/images-model.ts`, with tests.

### Integrações (apps and connections)

`/admin/integrations` (admin only) is a catalog of 18 apps. They are grouped by what they do for the desk:
- Publicação: WordPress, Ghost, Drupal.
- Fontes de notícias: Feeds RSS, Google Alertas, Estadão Conteúdo.
- Comunicação: Slack, Microsoft Teams, E-mail.
- Imagens: Unsplash, Pexels, Bynder.
- Automação: Webhooks, Zapier.
- Dados e audiência: Search Console (R3), Google Analytics (R6).
- Áudio e vídeo: Plaud (R3), YouTube (R4).

The catalog page works like this:
- The tabs are Todos, Conectados and Disponíveis, with a search.
- Each category is a Tray of cards. A card has the company's logo (BrandMark), its name and one line.
- Under that line come the status (Conectado, Com erro, Disponível, Em breve) and a few facts ("6 feeds · 71 em 24 h").
- The action is Conectar or Gerenciar.
- Inside a category, apps that need attention come first. Their problem sits under the card (AttachedNote) with the fix, for example "Planilha de pautas falhou nas últimas 3 entregas · Corrigir".
- Later releases show "Chega na R3" and have no page.

Each app has a page at `/admin/integrations/[app]`. There are two exceptions:
- WordPress keeps `/admin/integrations/cms`.
- Feeds RSS opens the desk's Fontes (`/news/sources`).

A connected app's page reads top to bottom:
1. **Conexão**: Reporter IA ⇄ the app (two BrandMarks joined), the account and who connected it, and figures where they help ("Avisos em 24 h", plan usage).
2. **Funcionamento**: one card per check (authorization, alerts with a channel, recipients, plan usage, keywords, events). A check that needs attention carries its problem and a link to the section that fixes it.
3. The app's settings:
   - Slack and Teams: Avisos, event → channel → on.
   - E-mail: recipients, the 8:00 summary and the alerts.
   - Photo banks: the credit format and "Salvar no acervo ao usar" (plan usage is a figure under the lockup).
   - Google Alertas: the alerts, one RSS feed per keyword, with "Adicionar alerta".
   - Agency: editorias.
   - Zapier: the events it receives.
   - Ghost and Drupal: the site and "Enviar como".
4. **Como funciona**: how the connection works in practice.
   - The method, for example "Senha de aplicativo do WordPress (REST API)" or "OAuth 2.0: o app Reporter IA instalado no workspace".
   - The API address (copy), how the Reporter IA signs in, and the credential it keeps (never the secret: "Access Key ••••a91f").
   - The OAuth permissions (`chat:write, channels:read…`) and the plan's limit.
   - **Chamadas à API**: every call it makes (method, path, what for), for example `POST /posts`: Criar o post como rascunho.
5. **Atividade**: a Timeline.

The header has "Testar conexão". The ⋯ menu has "Desconectar", behind a confirmation.

An app that is not connected opens the guided connection on the same page. The Stepper under the lockup shows Conectar → Configurar → Testar.

**Conectar** shows, in the order the person works:
- **No {app}**: what to do in the other app, numbered (Timeline steps), each with the link to the exact page. A path on the person's site appears once the address is valid.
- What to paste back in the app, with copy: Bynder's OAuth return address, or the e-mail's DNS records (SPF, DKIM, DMARC).
- **O que o app vai permitir**: the OAuth permissions, with their technical names.
- **No Reporter IA**: the credential fields, checked before the call.

How each app connects:

| App | Method | Pasted here |
| --- | --- | --- |
| WordPress | Application password (REST API `/wp-json/wp/v2`) for an Editor user | site, user, application password (24 characters) |
| Ghost | Admin API key of a custom integration (JWT) | API URL, Admin API key (`id:segredo`) |
| Drupal | JSON:API with OAuth 2.0 (Simple OAuth, client credentials) | site, Client ID, Client secret |
| Google Alertas | The alert's RSS feed (Google Alertas has no API) | keyword, feed link (`www.google.com/alerts/feeds/…`) |
| Estadão Conteúdo | API key of the agency contract (`X-Api-Key`) | API address, key |
| Slack | OAuth 2.0, the Reporter IA app installed in the workspace (`chat:write`, `channels:read`, `groups:read`); private channels need `/invite @Reporter IA` | nothing |
| Microsoft Teams | OAuth 2.0 with Entra ID and admin consent (Graph `ChannelMessage.Send`, `Channel.ReadBasic.All`) | nothing |
| E-mail | Sent by the Reporter IA from the portal's domain, verified by DNS | sender |
| Unsplash | Access Key of an Unsplash app (`Client-ID`; Production raises 50 to 5,000 searches an hour) | Access Key |
| Pexels | API key (200 an hour, 20,000 a month) | key |
| Bynder | OAuth 2.0 with an app registered in the portal (return address given) | portal, Client ID, Client Secret |
| Zapier | Webhooks by Zapier, Catch Hook | hook address (`hooks.zapier.com`) |

Then:
- **Configurar** shows the same panels the connected app keeps, prefilled.
- **Testar** runs the checks one by one (ProgressSteps), and each one says what it found.

The step's primary is always in the header: "Conectar o site", "Adicionar ao Slack", "Validar chave", "Verificar domínio", then "Testar conexão" and "Concluir conexão". Until the test passes, "Concluir conexão" shows why it is waiting. Progress is kept, so leaving the page resumes the same step. Webhooks has nothing to connect: its endpoints are added in a drawer.

**WordPress** (`/cms`) follows the same layout:
- Its checks are the connection, the authors (people who sign as Redação), the categories (editorial-map topics without a portal category) and failed sends.
- Its sections are Modo de envio, Campos obrigatórios, Autores (Na redação → No portal), Categorias (No mapa editorial → No portal) and Envios. A failed send links back to its Entrega.
- Disconnected, it is the guided connection: the application password, then Modo de envio and Campos obrigatórios, then the test. The user typed becomes the CMS account.
- It still reads and writes `state.cms` through `useHardNews` (`updateCms`, `testCms`). The Entrega's "Enviar ao CMS" is unchanged.

**Webhooks** shows:
- the lockup with "Entregas em 24 h", "Entregues" (amber below 90%) and "Tempo médio";
- the endpoints as cards: address (copy), events, a signing secret (`whsec_••••••••y5ca`, show, copy, "Gerar novo segredo" with confirmation), the success rate of the last 20 and the last answer;
- an endpoint that keeps failing carries "Falhou nas últimas 3 entregas · 500" and "Reenviar falhas";
- each card has "Enviar teste" and a menu (Editar, Pausar or Retomar, Gerar novo segredo, Remover);
- "Adicionar endpoint" opens a drawer: name, https address and events (with their technical names, such as `news.priority_high`);
- **Entregas** is the log (event, content, endpoint, HTTP answer, time, when), with Todas or Falhas.
- **Como seu sistema recebe** is the contract for whoever builds the receiving end:
  - each delivery is a `POST` in JSON with `X-Reporter-Event`, `X-Reporter-Delivery` and `X-Reporter-Signature: t=…,v1=…`;
  - the receiver answers any 2xx within 10 s; otherwise there are 5 retries in 24 h (1 min, 5 min, 30 min, 2 h and 12 h);
  - **Conferir a assinatura**: HMAC SHA-256 of `t.corpo` with the endpoint's secret, equal to `v1`, and `t` less than 5 min old;
  - **Corpo**: the example's fields (`data.title`, `data.priority`, `data.desk_url`…) and a button that copies the whole JSON.

The events are the same list for chat, e-mail, Zapier and webhooks:
- Notícia de prioridade alta;
- Pauta aberta;
- Artigo escrito pela IA;
- Artigo aprovado;
- Enviado ao CMS;
- Falha no envio ao CMS;
- Fonte sem resposta.

Preview data and limits:
- The connections other than WordPress and the feeds live in `integrations/integrations-store.ts`. It is a separate client store with the desk's `useSyncExternalStore` pattern and the key `reporter.r2-integrations.v1`. It honours `?reset=1` when loaded with it, and two tabs of the same browser stay in sync.
- The seed is in `integrations-seed.ts`. Slack, Unsplash, Pexels and two webhooks are on. "Planilha de pautas" answers 500, and Slack's "Falha no envio ao CMS" has no channel.
- On load, every time moves by the time away, so "há 12 min" stays "há 12 min".
- The topic → category map is kept in this store. The Entrega does not read it yet: prefilling the category from the story's topic is a later plug point.
- Connections, tests and deliveries are simulated (about 1 s each). A secret is never stored: the record keeps the account and a description of the credential ("Senha de aplicativo de reporter-ia", "Access Key ••••a91f").
- The guides (steps, links, fields and their checks, permissions, API address, authentication, calls) and the webhook contract are data in `integrations/integrations-guides.ts`, with tests. The backend implements those calls. The agency's endpoints are illustrative until the contract defines them.
- Each company's logo is hotlinked through `AppDef.logo` in `integrations-model.ts`, never downloaded. It shows in BrandMark `src`, on the catalog card and in the lockup.
  - Simple Icons (CC0) serves WordPress, Ghost, Drupal, RSS, Unsplash, Pexels, Zapier, Search Console, Analytics and YouTube.
  - The site's favicon (`google.com/s2/favicons`, 128 px) serves Slack, Teams, Google Alertas, Estadão, Bynder and Plaud.
  - E-mail and Webhooks have no company and keep the DS glyph. A logo that fails to load falls back to the glyph. The backend can serve its own URLs in the same field.
- The pure rules are in `integrations/integrations-model.ts`, with tests: the catalog and its groups, search, statuses, events, address and key checks, secrets, delivery outcomes, health checks, the connect flow and the time shift. The guides' rules (field checks, links on the typed site, what a connection keeps) are in `integrations-guides.ts`.

### Modelos (carousel and static templates)

`/library/templates` keeps the R1 address and parameters (`?format&q&model`), so R1 links still open. In every build it is a gallery:
- The header names the default model ("Padrão: Seafood Manchete") and has **Criar carrossel**.
- The bar has the piece tabs (**Carrosséis** with its count, **Estáticos** "Em breve"), the search and the format (Feed 4:5, Quadrado 1:1, Stories 9:16 "Em breve").
- The models sit on **shelves by family** (Notícia, Explica, Podcast), each with its use line. With more than 1280 px of content the three shelves sit side by side, so the Feed catalog fits one 1920 × 1080 screen; below that they stack. A format without families (Quadrado) is one shelf without a heading.
- Each card is a **contact sheet of three real pages**, drawn by the R1 render: the cover, the model's signature page (its featured layout, else its other photo page, else "Ponto principal") and the quote. The counters stay those of the full sample ("1/7 · 5/7 · 6/7"). On a phone a card is the cover and the name. "Aprovado" and "Padrão" are the only marks.
- A search with no match says "Nenhum modelo encontrado" and offers the other format that has it ("Ver em Feed 4:5 · 1"), or "Limpar busca".

`?model=` opens the model's page:
- The DS Gallery shows every page: arrows, thumbnails, swipe, "2 de 7" and the lightbox. "Baixar" opens the PNG in a new tab, as the R1 review does.
- Beside it, **Limites de texto** follows the page on stage, and **Ficha** gives the family, style, format and size, slide range, photo pages and the 5-slide sequence (with the featured-layout note).
- **Outros modelos** lists the same format, the same family first.
- "Usar como padrão" uses the R1 per-browser default and its toast. The trail reads "Modelos › {modelo}" and goes back to the search and format the model was opened from.

**Criar carrossel** opens a drawer with the productions whose article is approved and whose carousel has not started (not archived, carousel stage selectable and `not_started`, among the 50 most recent). Each row opens `/productions/{id}/carousel?model={id}`, where the R1 start already preselects the model. With none, it says "Nenhum artigo aprovado" and offers "Abrir produções". The fixtures have none until an article is approved (Aurora, as Pedro).

**Estáticos stays "Em breve"** (open decision for João). A static post cannot be shown honestly with what exists:
- The R1 render can draw one layout alone, but every layout carries the page counter: `canvas.ts` draws `n/total` unless the layout data says `counter: false`, and no model does. A one-page piece reads "1/1".
- The banner studio (`/banners`) renders on the server (`sharp`) through `runtime.visuals`, which the fixtures build does not have.
- There is no static piece kind or start route to create one.

To unlock it: a static variant of the render (one page, no counter), a static piece kind and its start route. The tab then shows the same shelves with one page per card and a format note.

The pure rules are in `templates/templates-model.ts`, with tests. The R1 library is imported, never edited (`useTemplatePreview`, `library-model`, `last-template`, `use-library-params`).

## What is simulated (for the backend to replace)

- `src/domain/hard-news.ts` holds the contract: news, feeds, classification, map, guide, dossier, sources, outline, evidence, enrichment, CMS, quote bank, archive and images.
- `src/features/hard-news/state/` keeps the desk in this browser (`desk-store.ts`, `hard-news-provider.tsx`). The backend serves the same shapes through ports, so the screens keep their hooks (`useHardNews`, `useDossier`, `useDeskStudio`, `useDeskBoard`).
- `src/features/hard-news/preview/` holds the fictional seafood desk data, the research results, the written drafts, the evidence flags and the enrichment suggestions.
- The radar is simulated in `news/use-radar.ts` and `preview/arrivals.ts`. While the desk is open, rounds of arrivals land: an outlet joins the tilápia story at +40 s, then a high-priority story at +90 s with a toast, then others. Each visit after a break plays a new round. The source that is due is read every minute, and postponed stories come back on their own (`returnedAt`, "Voltou").
- `state/hard-news-state.ts` moves the desk's clock to now on load (`rebase`), so the example never reads "há 13 h". `migrate` merges example records added later (news, photos, quotes) by id, and keeps "Novas" from the person's last look (`radar.seenSince`, `lastSeenAt`). Two tabs of the same browser stay in sync (storage event).
- The radar's pure rules (board, groups, strip, arrivals per hour, labels) are in `news/radar-model.ts`, with tests.

Backend work this preview does not do:
- RSS ingestion and dedup, pushing arrivals to an open radar, and the per-person "seen" receipt;
- the AI triage;
- web research;
- generation;
- the evidence check;
- the RAG index;
- the CMS adapter;
- the other connectors: OAuth and key storage, chat and e-mail alerts, webhook delivery with HMAC signing, retries and the delivery log;
- recording a CMS delivery (channel `cms`, `externalRef`) in the production's delivery history;
- the server-side quote check against the quote bank. The local simulated store skips the transcript quote check only for sourceless productions in the R2 preview.

## R1 files with R2 plug points

Each plug point is inert before R2 (the demonstration hides the desk from them):
- `registries/release.ts`, `registries/navigation.ts`, `ui/r2-preview.ts`, `ui/routes.ts`, `ui/approval-copy.ts`, `ui/shell/workspace-shell.tsx`;
- `app/(workspace)/layout.tsx` and the R2 route pages;
- `features/production/{production-header,production-frame,production-index,trail}`;
- `features/productions/productions-kanban.tsx`;
- `features/studio/article/{use-studio-checks,use-article-studio,copilot-pane,editor-toolbar}`;
- `features/delivery/delivery-screen.tsx`, `features/review/review-screen.tsx`, `features/overview/overview-screen.tsx`;
- `domain/approval.ts` (one `SendItemId`);
- `adapters/local/store/send-check.ts`.

The Codex demonstration (`features/r2-prototype`, `docs/R2_UI_PROTOTYPE.md`) was removed when the R2 screens replaced it in R1 builds.
