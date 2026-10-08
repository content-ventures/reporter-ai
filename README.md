# Reporter IA

Produto da Content Ventures para automatizar fluxos de produção editorial.

Este repositório está na **R1 · Experiência**: a interface completa da R1 roda no navegador sobre uma simulação local, sem backend, banco, login ou IA real. A versão publicada continua 0.1.0 (R0); a v1.0.0 sai com a **R1 · Conexão**, quando os adapters reais substituírem a simulação sem mexer nas telas.

## Escopo da R1 · Experiência

Fluxo: transcrição autorizada → artigo → aprovação → carrossel → aprovação → pacote exportado. Nenhuma peça avança sem decisão humana sobre a versão exata (REQ-T.6).

| Tela | Rota | O que faz |
|---|---|---|
| Visão geral | `/` | Indicadores, "Aguardando você", "Gerando agora", "Continue de onde parou", atividade e ritmo |
| Produções | `/productions` | Lista com abas, busca, filtros na URL e ação em massa |
| Nova produção | `/productions/new` | Colar ou enviar a transcrição (.txt .md .srt .vtt, até 2 MB), ligar falantes a pessoas, autorizar e gerar |
| Material | `/productions/[id]/source` | Transcrição, falantes, participantes e pauta editável |
| Estúdio do artigo | `/productions/[id]/article` | Geração ao vivo, edição, sugestões da IA, citações conferidas na fonte, versões |
| Revisão | `/productions/[id]/[peça]/review` | Alterações ou texto final, devolver com nota, aprovar |
| Carrossel | `/productions/[id]/carousel` | Textos dos slides derivados do artigo aprovado, prévia no modelo, limites conferidos |
| Entrega | `/productions/[id]/delivery` | Pacote com .md, .html, .json do carrossel, manifesto e PNG por slide; rastreabilidade e retorno do piloto |
| Novidades | `/whats-new` | Histórico de versões e o bloco "Em preparação · R1 · Experiência" |
| Logs | `/admin/audit` | Logins, acessos negados e alterações, só leitura e só para admin |

O menu lateral mostra o mapa inteiro, da R1 à R7. O que chega depois aparece com o selo "Em breve", sem link, e a dica diz o que a tela fará e em que release chega ("Fila de notícias com triagem por IA. Chega na R2 · Hard News"). A busca ⌘K lista só o que já abre.

Fica para a R1 · Conexão: backend e banco (F0.2), modelo e prompt reais (F1.2), login com sessão expirada (REQ-T.1), custo por execução (REQ-T.4), `.docx` e `pacote.zip` gerados no servidor, estado compartilhado entre aparelhos, trilha de auditoria persistida e upload de `.docx`.

## Simulação

- Tudo passa pelo adapter local (`src/adapters/local`), atrás das mesmas portas que o backend vai implementar.
- A geração é determinística: semente fixa, primeiro token em 0,6–0,9 s e passos de 0,8–2,5 s. Os fixtures têm textos escritos à mão; um material colado segue o caminho extrativo (perguntas viram intertítulos, respostas viram parágrafos com fonte), nunca inventa fatos e chega a ±10% da extensão pedida quando o material permite.
- O modelo "Simulação local" aparece uma vez por superfície (no menu de modelo do copiloto e em "Ver detalhes" de cada execução). Nenhum modelo é chamado e nenhuma execução mostra uso ou custo.
- ⌘K › Simulação reúne:
  - "Restaurar exemplo" e "Começar vazio";
  - "Entrar como …" para ver o produto com o papel de outra pessoa;
  - cenários armados para a próxima geração: falhar ao ler o material, falhar na seção 2, pausar para revisar a estrutura, falhar na sugestão da IA, falhar nos slides e geração lenta;
  - "Deixar o log indisponível", para a próxima consulta dos Logs.

## Persistência e reset

- O workspace fica no `localStorage` deste navegador (`reporter:sim:v1`, mais `reporter:sim:v1:drafts` para o rascunho e `reporter:audit:v1` para os eventos de log gravados ao vivo). As imagens ficam no IndexedDB `reporter-sim-assets`.
- Os dados são deste aparelho: outro navegador ou celular começa dos fixtures.
- `?reset=1` em qualquer rota, ou ⌘K › "Restaurar exemplo", reabre os fixtures e apaga as imagens. "Começar vazio" deixa só a equipe e os modelos e ainda não sobrevive a uma recarga.
- Recarregar no meio de uma geração não a interrompe: a geração segue de onde estava, como seguiria num servidor. Abrir outra aba também não: cada aba renova a posse das gerações que conduz (`reporter:run-lease:v1:<id>`), e uma aba só assume uma geração cuja aba sumiu (fechou, ou recarregou e não voltou em 3 s; travou por 15 s). Só uma geração que não pode continuar (material ou pauta mudaram) fica como "v1 · interrompida", com o texto parcial.
- Duas abas: a aba parada recarrega o que a outra salvou. Se o mesmo texto for editado nas duas, a mais antiga para de salvar, fica só leitura (texto, copiloto, sugestões e envio desligados) e mostra "Aberta em outra aba · Usar esta aba".
- Pauta editada: "Gerar nova versão" escreve com a pauta nova a partir do material, inclusive nos fixtures (o texto escrito à mão vale só para a pauta original). Um material curto rende o que tem, nunca texto inventado, e a extensão avisa antes ("O material rende ≈ N palavras").

## Fixtures

O workspace "Content Ventures" abre com a sessão de João (editor e admin). Pedro é o aprovador, Clara Souto e Rafael Dias são editores e Juliana Prates é editora e revisora criativa. Pessoas, empresas e números são fictícios.

| Produção | Estado | Onde ver |
|---|---|---|
| `prod-atelie-sul` | Geração em andamento ao abrir o app | `/productions/prod-atelie-sul/article` |
| `prod-estudio-norte` | Em edição, com sugestão aberta e uma citação que não bate com a fonte | `/productions/prod-estudio-norte/article` |
| `prod-aurora` | Artigo aguardando aprovação | `/productions/prod-aurora/article/review` |
| `prod-casa-forma` | Ajustes solicitados, com nota ancorada em dois trechos | `/productions/prod-casa-forma/article` |
| `prod-lume` | Artigo aprovado e carrossel aguardando aprovação | `/productions/prod-lume/carousel/review` |
| `prod-patio-couro` | Carrossel desatualizado depois de uma correção do artigo | `/productions/prod-patio-couro/delivery` |
| `prod-bella-passo` | Concluída: pacote exportado e retorno do piloto | `/productions/prod-bella-passo/delivery` |
| `prod-horizonte` | Geração interrompida na seção 2 | `/productions/prod-horizonte/article` |
| `prod-couro-nobre` | Material sem autorização, restrito a João e Clara | `/productions/prod-couro-nobre/source` |

Os fixtures vivem em `src/fixtures` e têm um teste de integridade (`fixtures.test.ts`).

## Arquitetura e pontos de plug

As camadas são verificadas por `pnpm harness:architecture`:

```
domain → ports → adapters/fixtures → runtime → state → ui, editor, features → app
```

- `src/domain`: tipos e regras puras (gates, checagens, status, manifesto), sem React, Next ou DS.
- `src/ports`: as interfaces que as telas conhecem. Um adapter real precisa passar nas mesmas suítes de contrato (`src/ports/contracts/*.contract.ts`).
- `src/runtime/create-runtime.ts`: a única raiz de composição. Um runtime remoto devolve o mesmo formato `Runtime`, e `src/state` e as telas ficam como estão.
- `src/registries`: navegação por release (`CURRENT_RELEASE = 'R1'`; `menuFor` devolve o menu R1–R7 com "Em breve", `navigationFor` só o que já abre), tipos de peça e de fonte, receitas, gates, checagens e ferramentas do copiloto. As próximas releases entram como dados.

| Porta | Hoje (adapter local) | Na R1 · Conexão |
|---|---|---|
| `ProductionQueries`, `ProductionCommands` | Store em `localStorage` com revisões e conflito de `baseRevision` | API e banco, regras impostas no servidor |
| `SourceIngest` | Leitura e análise no navegador | Upload e análise no servidor |
| `GenerationService` | Execuções simuladas com passos, deltas, falhas e "Tentar de novo" | Route Handler com modelo, prompt e execução persistida |
| `RenderService` | PNG dos slides em canvas, com medida de linhas | Render do fornecedor de templates |
| `ExportService` | Arquivos gerados no navegador | Exportação no servidor (`.docx`, `.zip`) |
| `AssetStore` | IndexedDB | Storage de arquivos |
| `SessionPort` | Membros do fixture e "Entrar como" | Sessão real e login |
| `FeedbackPort` | Votos e retorno do piloto no store | Log persistido |
| `AuditQueries` | Feed de atividade, cerca de 60 eventos semeados e eventos deste navegador | Trilha de auditoria no servidor |
| `Clock`, `IdGenerator` | Relógio e ids locais | Do servidor |

## Design System

- Toda interface visual vem da API pública `@content-ventures/design-system/v3` e de `/v3/icons`. Fora o reset do documento em `src/app/globals.css`, o Reporter não tem CSS próprio: `className`, `style`, elementos HTML em minúsculas, node views e DOM criado à mão são recusados pelo `pnpm harness:design`.
- Peça visual nova nasce no DS, com specimen, teste e linha no CHANGELOG do DS.
- O `package.json` fixa o DS num commit (tarball do GitHub). As telas da R1 usam o DS 0.2.0, que ainda está na branch `editorial-studio`: até ele ser publicado e fixado, um clone limpo não compila as telas da R1, e o desenvolvimento local copia o código do DS para o `node_modules`. Os dois fluxos estão em [docs/DEVELOPMENT_HARNESS.md](docs/DEVELOPMENT_HARNESS.md), seção "Updating the Design System (Atualizar o DS)".

## Requisitos

- Node.js 24 (`.nvmrc`).
- pnpm 10, via `corepack enable`.

## Desenvolvimento local

```bash
corepack enable
pnpm install
pnpm dev
```

Abra [http://localhost:3000/?reset=1](http://localhost:3000/?reset=1). O `pnpm install` também ativa os hooks do repositório.

## Verificação

| Comando | O que roda |
|---|---|
| `pnpm gate:quick` | Políticas de DS, arquitetura, densidade de conteúdo e versão; lint; tipos; testes (`node --test`) |
| `pnpm gate` | `gate:quick` e o build de produção |
| `pnpm smoke` | Playwright: o caminho principal (transcrição → falantes → autorização → geração → edição → envio → aprovação → carrossel → aprovação → pacote) e a varredura de rotas em 1440 e 390, sem erro de console e sem rolagem lateral |

O `pnpm smoke` reaproveita o servidor que já estiver em `localhost:3000`, normalmente o `pnpm dev`. Sem servidor, ele faz o build e sobe o `next start`; no CI, sobe o build que o job `quality` já fez (`SMOKE_PREBUILT=1`). Cada rota também confere uma `h1` só e nenhum nível de título pulado. `SMOKE_BASE_URL=http://localhost:3001 pnpm smoke` roda contra um build já no ar. Na primeira vez, instale o navegador com `pnpm exec playwright install chromium`.

As regras de branches, commits, PRs, DS, releases e deploys estão em [docs/DEVELOPMENT_HARNESS.md](docs/DEVELOPMENT_HARNESS.md).

## Roteiro de aceite

O aceite da R1 · Experiência é de UX: Pedro percorre os fixtures no computador e num celular de 390 px e aprova; Venâncio revisa `src/domain` e os contratos em `src/ports`.

Use o build de produção, nunca o `pnpm dev`: o indicador do Next cobre a troca de conta no canto da tela. O passo a passo está em "Acceptance build (Build de aceite)" no harness.

1. Abra `/?reset=1` em cada aparelho. Cada aparelho guarda os próprios dados.
2. Visão geral: Ateliê Sul aparece em "Gerando agora"; Aurora, em "Aguardando você".
3. Nova produção: "Usar exemplo", ligue os falantes, marque a autorização e clique em "Gerar artigo". Acompanhe a geração no estúdio.
4. Estúdio do Estúdio Norte: aceite ou descarte a sugestão (⌘↵ e Esc), corrija a citação com "Usar texto da fonte", salve com ⌘S e envie para aprovação.
5. Menu da conta › Entrar como Pedro. Revisão da Aurora: compare as versões e aprove, ou devolva com nota.
6. Casa Forma: a nota de Pedro ancorada no texto e "Aplicar nota com IA".
7. Horizonte: "Tentar de novo a partir desta etapa" continua a geração interrompida.
8. Lume: revise e aprove o carrossel.
9. Pátio Couro: escolha entre "Atualizar carrossel" e "Exportar com artigo v2".
10. Bella Passo: baixe o pacote e confira a rastreabilidade e o retorno do piloto.
11. Como João, abra Administração › Logs. Como Pedro, o item não aparece e a rota mostra acesso restrito.
12. No celular, repita os passos 3, 5 e 10.
