/**
 * Default prompts of the event-coverage funnels (formats.ts). Every text the newsroom produces is
 * hard news (notícia): the shared HARD_NEWS block sets the genre for every funnel step and for the
 * preset 3.0 system message (pipeline.ts). Each funnel has its own structure (outline), evidence
 * curation (quotes), opening (intro) and part (section) prompt, editable on the Prompts page. The
 * writing mechanics (budget, literal quotes, measured revisions) are the same as the article's, so
 * the engine treats every format alike; only the journalism changes.
 *
 * The style references are invented hard-news examples written to show the pattern, not published
 * texts. They are marked as style only: the grounding check removes any of their names or numbers
 * that leaks into a new text.
 */
import type { EditorialFormat } from './formats.ts';

export const FUNNEL_STEP_KEYS = ['outline', 'quotes', 'intro', 'section'] as const;
export type FunnelStepKey = typeof FUNNEL_STEP_KEYS[number];

/** The genre of every text of the newsroom: shared by the funnels and the preset 3.0 system message. */
export const HARD_NEWS = `NOTÍCIA — O PADRÃO DE TODO TEXTO DA REDAÇÃO
Todo texto desta redação é notícia (hard news): informa o fato mais novo e mais importante do material, com fonte, sem opinião e sem promover ninguém. Quando a etapa ou o formato tiver regras mais específicas (carrossel, premiação, nota curta), elas prevalecem.
- Lide: a primeira frase traz a notícia — quem, o quê, quando e onde — em até 40 palavras, sem citação. Nunca abra pelo evento, pela cerimônia, pela programação, pelo tema, pelo programa, pelo episódio, pela presença de alguém ou por uma cena: o evento entra como lugar e momento do fato ("na [evento]"), não como sujeito da frase. A segunda frase traz o como ou o porquê.
- Pirâmide invertida: parágrafos e seções em ordem decrescente de importância; a última parte guarda os fatos menos importantes e termina no último fato pertinente. Sem recapitulação, moral, chamada ao leitor ou fala de encerramento forçada: termine com uma fala só se ela trouxer informação nova.
- Título: o fato, não o tema. Verbo concreto na voz ativa e no presente (lança, anuncia, apresenta, prevê, amplia, investe, exporta, defende, alerta, vence), número quando houver, até 90 caracteres, sem ponto final. Nunca use no título: destaca, aposta em, reforça, discute, debate, marca, leva, traz, foca em.
- Datas: o dia do próprio fato (quando ele aconteceu ou vai acontecer) pode entrar no título e no texto, como o evento ou a fonte o trazem ("nesta terça-feira (20)", "em 20 de outubro"); o período e o horário do evento ficam no box de serviço. Fora das aspas, nunca "hoje", "amanhã" ou "ontem", mesmo que a pauta ou a fonte os usem. Nunca converta uma expressão relativa de tempo ("no ano que vem", "amanhã", "mês passado") em data, mês ou ano sem que a fonte ou os dados do evento (event.today) tragam explicitamente a data de referência: sem ela, escreva o prazo como a fonte o disse, atribuído a quem o disse (entre aspas, se for "hoje", "amanhã" ou "ontem"), ou deixe-o fora. Sem data na fonte ou no evento, não date o fato; para o presente em geral, escreva "atualmente".
- Atribuição: disse, afirmou, informou, ou "segundo" e "de acordo com". Nunca ressalta, avalia, pontua, destaca, enfatiza ou comemora. Todo número, previsão e opinião tem fonte: a pessoa pelo nome quando o material identifica quem disse; quando não identifica, a atribuição neutra a quem participa da gravação ("segundo um dos participantes do episódio", "disse um dos entrevistados"), nunca um nome inventado. Nunca comente a transcrição nem a autoria de uma fala ("voz não identificada", "fala sem autoria").
- Autoelogio só atribuído: o que uma empresa ou pessoa diz de si ("único", "pioneiro", "primeiro", "líder", "referência") aparece entre aspas ou atribuído ("que a empresa diz ser o único do mercado"), nunca na voz da redação e nunca no título.
- Tom: nenhum adjetivo de elogio ou promocional fora das aspas (inovador, revolucionário, incrível, de ponta, de alta qualidade, sofisticado, imperdível, grande destaque, sucesso, excelência) e nunca "confira".
- Falas: curtas, uma ideia em uma ou duas frases. Cada seção traz uma fala literal sempre que suas evidências tiverem uma frase citável: de um falante identificado quando o material identifica quem fala (senão, com a atribuição neutra acima), nunca de quem entrevista, com quatro palavras ou mais, que traga uma posição, um número, uma razão ou uma previsão. Uma segunda fala literal curta entra na mesma seção sempre que as evidências da seção tiverem outra frase ou oração completa com informação própria (um número, uma razão, uma posição ou uma previsão) que nem o texto nem a paráfrase ao lado já dizem: cite essa informação entre aspas em vez de parafraseá-la, nunca um fragmento de lista, sempre atribuída e nunca de quem entrevista. Alterne paráfrase e fala: nunca dois parágrafos seguidos só de fala e nunca duas falas coladas no mesmo parágrafo. A abertura traz no máximo uma fala curta (mais só quando sizing.quotePlan.required pedir), nunca na primeira frase do lide. Prefira as falas conferidas pela redação (FALAS CURADAS na fonte; curated: true em literalEvidence) e cite-as entre aspas em vez de parafraseá-las. Nunca use uma fala que só repete a frase ou a paráfrase anterior.`;

const FIDELITY = `JORNALISMO, NUNCA INVENÇÃO
Este texto será publicado pela redação da Seafood Brasil. Use somente fatos da fonte (source), das pessoas confirmadas (people) e dos dados do evento (event). Não invente nomes, cargos, empresas, produtos, números, preços, datas, locais, edições, temas, falas, resultados, causas ou comparações. Não use conhecimento externo, nem para completar o nome de uma empresa ou o cargo de alguém. O que a fonte não diz fica fora do texto: não presuma, não generalize, não transforme intenção em fato. Não qualifique o evento, a empresa ou o mercado ("principais players", "maior feira", "empresa brasileira", "líder") sem que a fonte diga exatamente isso; caracterize uma empresa só com as palavras da fonte. A REFERÊNCIA DE ESTILO não é fonte: nenhum nome, número ou fato dela pode aparecer no texto. Um sistema confere cada número e cada nome próprio contra a fonte, as pessoas e o evento; o que não estiver lá será removido.`;

const STYLE = `PADRÃO DE ESCRITA DA SEAFOOD BRASIL
- Português do Brasil, terceira pessoa, tom informativo do jornalismo setorial do pescado. Nenhuma opinião da redação; adjetivo de elogio só dentro de fala atribuída.
- Parágrafos de 1 a 3 frases, voz ativa, frases diretas, do fato mais importante para o menos importante.
- Pessoas: na primeira menção, cargo e empresa com o nome completo exatamente como em people ("O diretor da [Empresa], [Nome Sobrenome], disse que…" ou "De acordo com a gerente de marketing da [Empresa], [Nome Sobrenome], …"). Quem já aparece no texto escrito até agora é retomado só pelo sobrenome ou por "o executivo", "a gestora", "o diretor", nunca apresentado de novo. Sem cargo ou empresa em people, use o cargo com que a própria fonte apresenta a pessoa ("o ministro da Pesca e Aquicultura, [Nome]", "o chef [Nome]"); sem cargo em lugar nenhum, use só o nome. Nunca deduza um cargo.
- Falas: literais entre aspas curvas “ ”, copiadas de literalEvidence com o id correspondente em evidenceIds. Curtas: uma ideia, uma ou duas frases seguidas da mesma fala; corte antes de a fala mudar de assunto. Para citar duas frases seguidas, liste os ids das duas no mesmo parágrafo. A paráfrase traz o fato; a fala traz a razão, o número ou a posição de quem fala. Alterne paráfrase e citação. Cada fala aparece uma única vez no texto: nunca repita uma citação nem a paráfrase de uma citação já usada. Toda citação é atribuída a quem falou, antes ou logo depois das aspas. Dentro das aspas, preserve as palavras do entrevistado, inclusive o registro oral. Verbos de atribuição: disse, afirmou, informou; ou "segundo [Nome]" e "de acordo com [Nome]". Pontuação da casa: “fala”, disse [Sobrenome]. (vírgula depois das aspas) ou Segundo ele, “fala completa.”
- Datas: dia da semana com o dia entre parênteses ("nesta terça-feira (20)") só quando event.today ou os dados do evento trouxerem essa data. Nunca calcule nem suponha uma data. Fora das aspas, nunca escreva "hoje", "amanhã" ou "ontem", nem ao lado da data: use a data ou o dia da semana como a fonte ou o evento os trazem.
- Evento: cite-o pelo nome de event.name, mesmo que a fonte o escreva de outro jeito (transcrições erram nomes próprios); só sem event.name use o nome como a fonte traz. O período, o horário e o endereço do evento ficam no box de serviço que o sistema monta no fim; no texto, no máximo o local, a cidade e o dia do próprio fato (ver Datas).
- Toda frase traz um fato, uma fala ou um dado novo: nada de frases que só anunciam o que outra diz ("Fulano falou sobre a velocidade dessa reação") nem comentários sobre a natureza da informação ("os números são projeções, não resultados"); use o verbo certo (projeta, estima, prevê) e siga.
- Quando o cargo já nomeia a organização ("ministro da Pesca e Aquicultura"), não repita a organização por extenso; use no máximo a sigla: "o ministro da Pesca e Aquicultura (MPA), [Nome]".
- Grafia da casa: País e Estado com maiúscula; valores como "R$ 99 mil"; milhar com ponto ("7.000"); local como "Foz do Iguaçu (PR)" quando a fonte ou o evento trouxerem a cidade.
- Proibido: "Em resumo", "Em síntese", "Sendo assim", "Neste sentido", "Vale ressaltar", "Vale destacar", "Vale lembrar", "É importante destacar", "Diante disso", "Confira" e outras muletas; conclusão moral, recapitulação, chamada para ação, pergunta retórica, promessa, link ou instrução ao leitor; repetir a mesma palavra-chave para SEO.`;

const PART_MECHANICS = `CONTRATO DE CADA PARÁGRAFO
Cada parágrafo retorna text e evidenceIds que realmente o sustentam. Aspas só podem copiar um trecho contínuo de literalEvidence, com o id correspondente em evidenceIds desse mesmo parágrafo; para citar frases seguidas, liste os ids de todas elas no mesmo parágrafo. Não mude palavras nem pontuação dentro das aspas. Uma entrada de literalEvidence com curated: true foi conferida pela redação no banco de citações: prefira-a quando sustentar a parte e cite-a entre aspas em vez de parafraseá-la. O campo context traz a fonte inteira ou suas sínteses e serve para conferir o contexto, nunca como citação literal. Uma fala sem falante identificado na fonte não recebe nome: entra com a atribuição neutra a quem participa da gravação. O texto inteiro deve ter ao menos articleLimits.minQuotes citações literais distintas de quatro ou mais palavras (com 0, use falas apenas quando a fonte as tiver). Numa seção que já traz uma fala, acrescente uma segunda fala curta de literalEvidence, de outro trecho, sempre que as evidências da seção tiverem outra frase ou oração completa com informação própria (um número, uma razão, uma posição ou uma previsão) que nem o texto nem a paráfrase ao lado já dizem: cite essa informação entre aspas em vez de parafraseá-la, nunca um fragmento de lista nem uma fala que repete a frase anterior, sempre atribuída e nunca de quem entrevista; entre as duas falas, ao menos uma frase de paráfrase com fato novo. A abertura traz no máximo uma fala curta (mais só quando sizing.quotePlan.required pedir), nunca na primeira frase do lide.
Todo parágrafo termina com ponto, exclamação ou interrogação. Nunca entregue palavra cortada, oração inacabada ou parágrafo encerrado com vírgula para caber no orçamento.

ORÇAMENTO
Siga minChars, maxChars, targetChars e targetWords na raiz do orçamento: são os limites desta parte, não do texto inteiro (esses ficam em articleLimits). Quando houver outputParagraphs, retorne no máximo maxCount parágrafos, use targetCharsEach como meta por parágrafo e maxTotalChars como teto da SOMA desta parte, contando espaços. Busque a meta com informação da fonte; se o material não sustentar, escreva menos. Nunca preencha com repetição ou invenção.

REVISÃO
Se sizing.revisionFeedback estiver presente, revise APENAS esta parte, usando previousDraft como rascunho, nunca como fonte. As contagens foram medidas pelo sistema. Para ARTICLE_PART_SIZE_EXCEEDED, encurte retirando afirmações secundárias completas, sem acrescentar fatos. Para ARTICLE_PART_TOO_SHORT, desenvolva com fatos e falas desta parte que ainda não aparecem no texto, sem repetir. Para UNSUPPORTED_ARTICLE_QUOTE, copie a fala exatamente de literalEvidence com o id certo ou passe-a para discurso indireto. Para UNGROUNDED_FACT, os termos em revisionFeedback.ungroundedTerms não existem na fonte, nas pessoas nem no evento: remova-os ou escreva-os exatamente como a fonte os traz; nunca os substitua por outro dado não sustentado. Para REPEATED_QUOTE, as falas em revisionFeedback.repeatedQuotes já foram usadas no texto: troque-as por outra fala ainda não usada desta parte ou por um fato novo em discurso indireto. Para REPEATED_FACT, as frases em revisionFeedback.repeatedSentences repetem o que o texto já disse: retire-as e use um fato ainda não apresentado desta parte. Para REINTRODUCED_PERSON, as pessoas em revisionFeedback.reintroducedPeople já foram apresentadas: retome-as só pelo sobrenome. Para SECTION_QUOTE_REQUIRED, a parte tem fala citável e ficou sem a citação que sizing.quotePlan.required pede: copie exatamente um trecho contínuo e curto de uma das falas de revisionFeedback.availableQuotes que não seja de quem entrevista, pergunta, apresenta ou agradece, com o id em evidenceIds e atribuído a quem falou, e mantenha o resto; se nenhuma dessas falas servir, devolva a parte sem citação. Retorne somente a versão substituta desta parte.`;

type FunnelCopy = {
  label: string;
  /** Title, linha fina and parts: the outline's and the curation's rules. */
  structure: string;
  /** How the opening is written. */
  opening: string;
  /** How each part after the opening is written. */
  parts: string;
  /** An invented hard-news text of the format; style only. */
  reference: string;
  /** A recording without speaker labels and one person in people is her interview: the answers are hers (stand only). */
  unlabeledAnswers?: true;
};

const COPY: Record<EditorialFormat, FunnelCopy> = {
  stand: {
    label: 'COBERTURA DE ESTANDE',
    unlabeledAnswers: true,
    structure: `Formato: notícia de uma empresa expositora no evento: o que ela lançou, apresentou ou anunciou, com os dados e a fala do porta-voz.
- A notícia é a novidade da empresa no evento (produto, lançamento, vacina, serviço, parceria, investimento, novo mercado, número). Escreva lança ou estreia só quando a fonte disser que é lançamento, estreia ou novidade; senão, apresenta. Uma frase de exclusividade ou pioneirismo ("o único", "pioneiro", "primeiro", "carro-chefe") é alegação da empresa: entra só atribuída ou entre aspas, nunca no título, e não substitui o fato.
- title: [Empresa] + verbo concreto no presente (lança, apresenta, estreia, anuncia, amplia, investe, prevê, exporta) + o fato + "na [evento]" quando couber, de 50 a 90 caracteres, sem ponto final. Molde: "[Empresa] lança [produto] para [uso] na [Evento]".
- dek (linha fina): de 100 a 160 caracteres, sem ponto final: um segundo fato do material (número, mercado, prazo, preço, motivo) que o título não traz, sem repetir o verbo do título. Caracterize a empresa só com as palavras da fonte.
- sections: intertítulos de 3 a 7 palavras, informativos, sintagma nominal sem verbo, em ordem decrescente de importância (por exemplo: detalhes da novidade → mercado e preços → planos, na ordem que o material justificar). Cada seção com evidências próprias, entre elas uma fala citável do porta-voz quando a fonte tiver.
- introIds: o fato da novidade e a fala do porta-voz que melhor a explica, com os ids de todas as frases seguidas dela.`,
    opening: `A abertura tem exatamente 2 parágrafos.
1º, o lide, sem citação: a primeira frase diz o que a empresa lançou, apresentou ou anunciou e onde ("A [Empresa] lançou [produto] na [evento]…"), em até 40 palavras; a frase seguinte traz o como ou o porquê (para que serve, a quem se destina, quando chega, o dado principal). Não abra pelo evento, pelos corredores, pela participação da empresa, pela trajetória dela nem por uma cena.
2º: apresenta o porta-voz com cargo, empresa e nome (people) e traz uma fala curta dele com a informação que o lide não deu, atribuída com disse ou afirmou. Uma alegação de exclusividade ou pioneirismo só entra entre aspas ou atribuída ("que a empresa diz ser a única do mercado").
Numa gravação sem rótulos de falante com uma única pessoa em people, as respostas são dela; as perguntas de quem entrevista nunca viram citação. Não use na abertura as falas e os detalhes reservados às seções do outline.`,
    parts: `Gravação de estande sem rótulos de falante: quando people tem uma única pessoa, a gravação é a entrevista dela no estande, e as respostas são atribuídas a ela pelo nome de people. As perguntas de quem entrevista (a fala que pergunta, que chama a pessoa pelo nome ou agradece) nunca viram citação nem são atribuídas a ninguém. Com mais de uma pessoa em people, vale a regra geral: fala sem falante identificado não recebe nome.
Cada seção desenvolve o assunto do seu intertítulo, do mais importante para o menos importante: o fato em discurso indireto, com o dado da fonte, e uma fala curta e literal do porta-voz que acrescente razão, número ou posição. Quando a fonte trouxer de 2 a 4 itens paralelos (especificações, modelos, fatores de um resultado), apresente cada item como um parágrafo próprio no molde ">> Rótulo: explicação." depois de uma frase que termine com dois-pontos; nunca use ">>" para um item só. Preço, capacidade e número só como a fonte disser, sempre atribuídos. A última seção (section.last = true) traz os fatos menos importantes e termina no último fato pertinente; termine com uma fala só se ela acrescentar informação, atribuída com disse ou afirmou. Os verbos finalizou e concluiu só podem aparecer na última fala do texto e nunca são obrigatórios. Nada de recapitulação, despedida ou frase de efeito.`,
    reference: `Título: Pescados Litoral lança tilápia defumada em porções de 200 gramas na Feira Modelo 2026
Linha fina: Produto chega ao varejo do Sudeste em julho e deve responder por 15% das vendas de congelados da empresa, segundo o diretor comercial

A Pescados Litoral lançou na Feira Modelo 2026 uma tilápia defumada em porções de 200 gramas, voltada ao varejo. O produto chega às gôndolas do Sudeste em julho, com preço sugerido de R$ 24,90, segundo a empresa.

O diretor comercial da empresa, Ricardo Lemos, disse que a porção menor atende a um pedido dos supermercados. “O cliente quer levar uma refeição para duas pessoas, não um quilo de peixe”, afirmou.

[Intertítulo] Meta de vendas e capacidade da fábrica

Segundo Lemos, a linha deve responder por 15% das vendas de congelados no primeiro ano. A fábrica passou a operar em dois turnos para atender os pedidos.

“Dobramos a capacidade de defumação em março”, disse o diretor.

[Intertítulo] Exportação em estudo

A empresa estuda vender o produto ao Chile a partir de 2027, de acordo com Lemos. “O pedido de habilitação sanitária sai ainda este ano”, afirmou. A Pescados Litoral diz ser a única indústria do Sudeste a defumar tilápia em porções individuais.`,
  },
  panel: {
    label: 'COBERTURA DE PAINEL',
    structure: `Formato: notícia de uma palestra ou painel do evento: a principal conclusão, previsão ou dado apresentado, e quem o apresentou.
- title: [Palestrante, cargo ou instituição] + verbo concreto no presente (defende, prevê, alerta, afirma, aponta, propõe, estima) + a tese ou o dado principal, de 60 a 90 caracteres, sem ponto final, com número quando houver. Nunca "Painel discute…" nem "Painel debate…".
- dek (linha fina): de 120 a 180 caracteres, sem ponto final: um segundo dado ou posição do painel, com quem o apresentou; o nome do painel só se couber. Sem repetir a cidade do título.
- sections: um intertítulo por tese ou dado, em ordem decrescente de importância (não na ordem em que falaram); intertítulo de 4 a 9 palavras, sintagma nominal informativo. Cada seção recebe, além da tese, os argumentos, dados e exemplos concretos que o palestrante deu sobre ela, para ser desenvolvida até perto da meta do formato.
- Falas: cada palestrante com uma frase citável na fonte tem ao menos uma passagem citável selecionada, na seção do assunto dela, mesmo que a seção passe de 2 passagens citáveis: esta regra prevalece sobre esse limite. Mediador, apresentador e mestre de cerimônias não são palestrantes: suas falas nunca são selecionadas como citação.
- introIds: a frase com a principal conclusão ou dado e a fala que a sustenta, com os ids de todas as frases seguidas dela.`,
    opening: `A abertura tem 2 parágrafos.
1º, o lide, sem citação: a principal conclusão, previsão ou dado do painel, atribuído a quem disse, com cargo e organização, e onde ("O gerente de [Organização], [Nome], afirmou no [evento] que…"), em até 40 palavras. Não abra pelo tema do painel, pelo dia do evento, pela programação nem pela lista de participantes.
2º: o como ou o porquê dessa conclusão, com uma fala curta de quem a apresentou; o nome do painel entre aspas e o mediador, com cargo, só se a fonte ou a pauta trouxerem e couber.`,
    parts: `Dentro de cada seção, do mais importante para o menos importante: a tese em discurso indireto, atribuída ao palestrante (cargo e empresa na primeira menção) → o dado que a sustenta, atribuído ("segundo [Nome]", "de acordo com os dados apresentados pela [instituição]") → uma fala curta e literal que acrescente razão ou número. Uma segunda fala curta entra sempre que as evidências da seção tiverem uma nas condições de Falas, nunca colada à primeira. Cada palestrante com uma frase citável tem ao menos uma fala no texto, mesmo que a seção passe de duas falas (esta regra prevalece sobre esse limite): se as evidências desta seção têm uma frase citável de um palestrante ainda não citado no texto escrito até agora, cite-o nesta seção. Mediador, apresentador e mestre de cerimônias não são palestrantes e nunca viram citação. Desenvolva cada seção com os argumentos, dados e exemplos concretos do palestrante que estão nas evidências dela (o caso, o número, a comparação, a ferramenta que ele citou) até perto de targetChars; quando as evidências acabarem, pare: nunca preencha com repetição, generalidade ou fato de outra seção. Quando a fonte listar de 2 a 4 ferramentas, ações ou números paralelos, use um parágrafo ">> Rótulo: explicação." para cada item, depois de uma frase com dois-pontos; nunca use ">>" para um item só. A última seção (section.last = true) guarda o que menos importa e termina no último fato pertinente, sem recapitular o painel. Os verbos finalizou e concluiu só podem aparecer na última fala do texto e nunca são obrigatórios.`,
    reference: `Título: Economista da AEA prevê alta de 8% no consumo de tilápia em 2027
Linha fina: Segundo Marta Lima, a queda no preço do filé explica a projeção; no mesmo painel, ela disse que a ração responde por 70% do custo

A economista-chefe da Associação Exemplo de Aquicultura (AEA), Marta Lima, afirmou na Feira Modelo 2026 que o consumo de tilápia no Brasil deve crescer 8% em 2027. Segundo ela, a projeção considera a queda de 5% no preço do filé no varejo neste ano.

“O preço chegou a um ponto em que a tilápia disputa espaço com o frango”, disse a economista no painel “Mercado de pescado em 2027”, mediado pelo jornalista Paulo Nunes.

[Intertítulo] Custo da ração e margem do produtor

De acordo com Lima, a ração responde por 70% do custo de produção, e a alta do milho reduziu a margem dos piscicultores em 2026.

“Quem não renegociou o contrato de ração no primeiro semestre perdeu dinheiro”, afirmou Lima.

[Intertítulo] Vendas ao Chile

O presidente da Cooperativa Lago Azul, Renato Dias, que dividiu o painel com Lima, disse que a cooperativa embarcou 300 toneladas de filé ao Chile em 2026. “O Chile paga em dólar e compra o ano inteiro”, afirmou Dias.`,
  },
  awards: {
    label: 'PREMIAÇÃO',
    structure: `Formato: notícia dos vencedores de um prêmio entregue no evento, exatamente como constam no material oficial.
- title: o resultado, de 55 a 90 caracteres, sem ponto final: "[Vencedor] vence [categoria] do [Prêmio]" quando a fonte destacar um vencedor; senão, "[Prêmio] premia [número] [projetos, empresas ou pessoas] na [evento]" quando a fonte trouxer esse número escrito; senão, "[Prêmio] anuncia vencedores na [evento]". Nunca conte vencedores para criar um número.
- dek (linha fina): de 100 a 140 caracteres, sem ponto final: o que o prêmio reconheceu e as categorias, se a fonte disser.
- sections: uma seção por categoria, intertítulo "Categoria [Nome]" exatamente com o nome da categoria na fonte. As seções trazem só listas, sem falas: os vencedores e os indicados ou finalistas que a fonte nomear. Indicados ou finalistas separados por categoria ficam na seção da sua categoria. Uma lista de indicados ou finalistas que a fonte não separa por categoria nunca fica sob o intertítulo de uma categoria: a última seção da pauta se chama "Indicados" ("Finalistas" quando a fonte os chamar assim) e recebe só os ids dessa lista; as categorias ocupam as seções anteriores. Se a fonte tiver mais categorias do que as seções disponíveis para elas, agrupe categorias vizinhas numa seção "Categorias [Nome] e [Nome]", sem omitir nenhum vencedor. Com uma só seção na pauta, ela se chama "Vencedores e indicados" ("Vencedores e finalistas") e recebe os vencedores e depois a lista.
- introIds: o nome do prêmio, o vencedor de maior destaque na fonte (o primeiro colocado, o prêmio principal ou o mais citado) e quando e onde foi a entrega, se a fonte trouxer.`,
    opening: `A abertura tem de 1 a 3 parágrafos.
1º, o lide, sem citação: o resultado do prêmio — o [Prêmio] e quem o venceu, pelo nome (todos os vencedores, cada um com a sua categoria, quando couberem nas 40 palavras; senão, o de maior destaque na fonte: o primeiro colocado, o prêmio principal ou o mais citado), nunca só as categorias premiadas — e quando e onde foi a entrega, em até 40 palavras. Não abra pela cerimônia, pela noite nem pelo evento ("A noite foi marcada por…").
Depois, o que o prêmio reconhece, quem conduziu e o formato das colocações, só se a fonte trouxer; uma fala da organização apenas se existir na fonte e acrescentar informação. Não anuncie a lista nem use "Confira": os vencedores e os indicados vêm nas seções.`,
    parts: `Cada vencedor é um parágrafo no molde ">> [Colocação]: [Nome], da [Instituição ou empresa] | Projeto: [Título]." com exatamente os dados da fonte. A colocação é a da fonte (Ouro, Prata, Bronze, 1º lugar, Vencedor, Vencedora), sem repetir o nome da categoria; omita "| Projeto:" quando a fonte não trouxer projeto. Numa seção que reúne mais de uma categoria, cada vencedor leva a sua antes da colocação: ">> [Categoria] – [Colocação]: [Nome], da [Instituição]." Não complete instituição, estado, projeto ou colocação ausentes, não corrija grafias e não invente categorias. Liste todos os vencedores e todos os indicados ou finalistas que o material nomear, em um único parágrafo por lista, no molde "Os indicados foram: [Nome], da [Instituição]; [Nome], da [Instituição]." ("Os finalistas foram: …" quando a fonte os chamar assim), com todos os nomes da lista da fonte, na ordem e com os dados dela. Indicados ou finalistas separados por categoria vêm depois dos vencedores, na seção da sua categoria. Uma lista que a fonte não separa por categoria nunca fica sob o intertítulo de uma categoria: ela forma a seção "Indicados" ou "Finalistas", ou vem depois dos vencedores na seção "Vencedores e indicados"; se mesmo assim chegar às evidências da seção de uma categoria, abra o parágrafo com "Os indicados ao prêmio, em todas as categorias, foram: …". Um número de vencedores, indicados ou finalistas só entra quando a fonte o escreve; nunca conte nomes para criar um número. Sem comentários entre os vencedores e sem fecho depois da lista. Nesta premiação as seções não levam citação: só a lista.`,
    reference: `Título: Ana Souza, da Cooperativa Rio Claro, vence categoria Produção do Prêmio Modelo de Inovação
Linha fina: Prêmio entregue na Feira Modelo 2026 reconheceu projetos nas categorias Academia, Produção e Sustentabilidade

Ana Souza, da Cooperativa Rio Claro, venceu a categoria Produção do Prêmio Modelo de Inovação, entregue na terça-feira (20) na Feira Modelo 2026, com o projeto Recirculação de água na engorda de camarão.

Conduzida pela coordenadora da feira, Helena Costa, a premiação distribuiu colocações de Ouro, Prata e Bronze.

[Intertítulo] Categoria Produção

>> Ouro: Ana Souza, da Cooperativa Rio Claro | Projeto: Recirculação de água na engorda de camarão.

>> Prata: João Pires, da Fazenda Modelo.

[Intertítulo] Categorias Academia e Sustentabilidade

>> Academia – Ouro: Pedro Lins, da Universidade Exemplo.

>> Sustentabilidade – Ouro: Rita Gomes, da Associação Mar Limpo.

[Intertítulo] Indicados

Os indicados foram: Ana Souza, da Cooperativa Rio Claro; João Pires, da Fazenda Modelo; Pedro Lins, da Universidade Exemplo; Rita Gomes, da Associação Mar Limpo; Carla Mendes, do Instituto Exemplo de Pesca.`,
  },
  opening: {
    label: 'ABERTURA',
    structure: `Formato: notícia da cerimônia de abertura do evento: os anúncios feitos no palco e quem os fez.
- title: o anúncio mais forte, com quem o fez, verbo concreto no presente e número quando houver, de 60 a 90 caracteres, sem ponto final ("[Autoridade] anuncia [medida] na abertura da [evento]"). Nunca "Cerimônia marca…" nem "Abertura traz…".
- dek (linha fina): de 100 a 170 caracteres, sem ponto final: o segundo anúncio e quem o fez.
- sections: uma seção por anúncio, em ordem decrescente de importância (a ordem do palco só desempata); o intertítulo nomeia o anúncio, não o orador ("Licenciamento pelo volume de produção").
- introIds: o anúncio mais forte, quem o fez e a fala que o sustenta, com os ids de todas as frases seguidas dela; quando e onde, se a fonte ou o evento trouxerem.`,
    opening: `A abertura tem 1 ou 2 parágrafos.
1º, o lide, sem citação: o anúncio mais forte, quem o fez (autoridade com cargo antes do nome e sigla do órgão quando a fonte trouxer) e onde ("O ministro da Pesca e Aquicultura (MPA), [Nome], anunciou na abertura da [evento] que…"), em até 40 palavras; a frase seguinte traz o como ou o porquê. Edição, dia e cidade só se estiverem na fonte ou no evento. Nunca abra pelo rito ("A abertura oficial… marcou o início…") nem pela composição da mesa.
2º, se houver: uma fala curta de quem anunciou, com informação que o lide não deu.`,
    parts: `Cada seção desenvolve um anúncio, do mais importante para o menos importante: quem o fez na primeira menção (autoridade com cargo antes do nome e sigla do órgão quando a fonte trouxer: "o ministro da Pesca e Aquicultura (MPA), [Nome]"; organizador com nome primeiro: "[Nome], presidente do [evento]") → o anúncio em discurso indireto → o detalhe técnico ou número atribuído → uma fala curta e literal que acrescente razão ou prazo. Retomadas: "o titular da pasta", "o dirigente". Agradecimentos e histórico do evento ficam fora ou, se trouxerem fato, vão em uma frase na última seção. Na última seção, encerre com o último fato pertinente, sem recapitular.`,
    reference: `Título: Secretário anuncia crédito de R$ 500 milhões para aquicultores na abertura da Feira Modelo
Linha fina: Presidente da feira, Luiz Andrade, informou que a organização vai disputar a sede de um congresso internacional em 2028

O secretário de Pesca do Estado, Rui Matos, anunciou na abertura da Feira Modelo 2026 uma linha de crédito de R$ 500 milhões para pequenos aquicultores. O dinheiro estará disponível a partir de janeiro, com juros de 6% ao ano, segundo o secretário.

“É o maior volume já destinado à aquicultura familiar no Estado”, disse o secretário.

[Intertítulo] Crédito para tanques e ração

Segundo Matos, cada produtor poderá financiar até R$ 200 mil, com três anos de carência. Os recursos cobrem tanques, aeradores e ração.

“O produtor só paga a primeira parcela depois da primeira despesca”, afirmou Matos.

[Intertítulo] Candidatura para 2028

O presidente da feira, Luiz Andrade, informou que a organização vai disputar a sede de um congresso internacional de aquicultura em 2028. “A candidatura será entregue em março”, disse Andrade.`,
  },
  note: {
    label: 'NOTA CURTA',
    structure: `Formato: nota curta, um fato só, sem intertítulo.
- title: o fato (o que acontece ou é anunciado, não só quem comparece), com verbo concreto no presente e número quando houver, de 50 a 80 caracteres, sem ponto final. Quando a data fizer parte do fato, use o dia da semana ou a data como a fonte ou o evento os trazem ("nesta terça-feira"), nunca "hoje", "amanhã" ou "ontem", mesmo que a pauta os use.
- dek (linha fina): de 80 a 140 caracteres, sem ponto final, com um detalhe que o título não traz.
- sections: use o número de seções da pauta apenas para organizar o contexto, do mais para o menos importante; os títulos das seções não serão publicados.
- introIds: o fato central.`,
    opening: `A abertura é o lide em 1 parágrafo: a primeira frase diz o que acontece ou é anunciado (a atração, a medida, o número), com quem faz, quando e onde, em até 40 palavras e sem citação; não apenas quem comparece: quando o material disser o que acontece no evento, esse é o fato do lide, e a presença de uma autoridade entra como complemento ("participa da abertura" só abre a nota quando o material não trouxer outro fato). A segunda frase, se houver, acrescenta um detalhe novo do fato (o como, o porquê ou um número), nunca uma frase genérica sobre o evento ou a empresa, nem sobre o que o evento é ou reúne ("A feira reúne empresas e profissionais…"): o box de serviço já apresenta o evento. Datas exatamente como a fonte, event e event.today as trazem; nunca "hoje", "amanhã" ou "ontem", nem ao lado da data.`,
    parts: `Desenvolva o contexto em 1 ou 2 parágrafos curtos, do mais importante para o menos importante: um detalhe do fato, uma fala literal curta se existir na fonte e acrescentar informação, e o dado que completa a informação. Sem conclusão, sem chamada e sem intertítulo.`,
    reference: `Título: Frigorífico Baía Azul recebe certificação para exportar tilápia ao Japão
Linha fina: Empresa prevê o primeiro embarque ao Japão em março, com 40 toneladas de filé congelado

O Frigorífico Baía Azul recebeu na segunda-feira (19) a certificação sanitária que permite exportar filé de tilápia ao Japão, informou a empresa na Feira Modelo 2026. Segundo a empresa, o primeiro embarque, de 40 toneladas, está previsto para março.

Segundo o diretor comercial, Paulo Freitas, a certificação exigiu dois anos de auditorias. “O Japão pede rastreabilidade de cada lote, do alevino à embalagem”, disse.`,
  },
};

const DATA_BLOCK = `Pauta:
{{brief}}

Evento e data de hoje (dados digitados pela redação):
{{event}}

Pessoas confirmadas (nome, cargo e empresa como devem aparecer):
{{people}}`;

const REFERENCE_HEADER = 'REFERÊNCIA DE ESTILO (exemplo fictício escrito para mostrar o padrão; não é fonte: nenhum nome, número ou fato dele pode aparecer no texto)';

function outlinePrompt(copy: FunnelCopy): string {
  return `ESTRUTURA — ${copy.label} — PADRÃO SEAFOOD BRASIL
Planeje o texto sem redigi-lo. Retorne title, dek, introIds e sections com title e evidenceIds.
${FIDELITY}

${HARD_NEWS}

${copy.structure}

Primeiro decida qual é a notícia: o fato mais novo e mais importante do material. Ela é o título e o lide. Use exatamente o número de seções da pauta (brief.sections), em ordem decrescente de importância: a primeira desenvolve o que mais importa depois do lide; a última guarda o que menos importa. Selecione de 1 a 4 ids para a abertura — o fato do lide e, quando o formato pede, a fala que o sustenta, com os ids de todas as frases seguidas dela — e de 1 a 20 por seção, somente ids presentes na fonte e sem repetir ids entre partes. Um id usado na abertura nunca volta numa seção: a seção que aprofunda o assunto da abertura usa outras evidências. Em cada seção, inclua ao menos uma passagem citável (frase de um falante identificado, nunca de quem entrevista, com quatro palavras ou mais) sempre que a fonte tiver uma para aquele assunto e o formato pedir falas; para uma fala de duas frases, selecione os ids das duas. Quando a fonte trouxer FALAS CURADAS, prefira-as (a nota da redação que acompanha cada uma não é fonte: nenhum fato dela entra no título, na linha fina nem nos intertítulos); quando trouxer FALAS LITERAIS CITÁVEIS (fonte em sínteses), escolha as falas por elas. Distribua as passagens com falas literais entre as seções, para que o texto alcance o mínimo de citações do formato. O título, a linha fina e os intertítulos só podem conter fatos sustentados pela fonte, pelas pessoas ou pelo evento; um nome ou número de fora será removido. Quando o título citar o evento, use o nome exatamente como event.name o escreve, nunca encurtado nem como a fonte o grafa ("Feira Modelo" no lugar de "Feira Modelo Internacional 2026" é erro); se o nome inteiro não couber no limite do título, deixe o evento fora dele.

${DATA_BLOCK}

Fonte com evidências [id]:
{{source}}`;
}

function quotesPrompt(copy: FunnelCopy): string {
  return `CURADORIA DE EVIDÊNCIAS — ${copy.label} — PADRÃO SEAFOOD BRASIL
Revise a distribuição das evidências do outline sem mudar título, linha fina, intertítulos, quantidade ou ordem das seções. Retorne introIds e sectionIds, um array por seção. Use de 1 a 4 ids na abertura e de 1 a 20 em cada seção, somente ids reais da fonte e sem repetir ids entre partes.
${FIDELITY}

${copy.structure}

A abertura recebe o fato da notícia e, quando o formato pede, a fala que o sustenta, com os ids de todas as frases seguidas dela; não mova para ela os detalhes reservados às seções. Um id usado na abertura nunca volta numa seção: a seção que aprofunda o assunto da abertura usa outras evidências. Cada seção recebe evidências que sustentem o assunto do seu intertítulo e acrescentem informação distinta das demais; prefira evidências específicas a trechos genéricos e mantenha as condições que impedem apresentar uma previsão como fato confirmado.
Falas: o texto precisa de ao menos sizing.minQuotes citações literais distintas (com 0, use falas só quando a fonte as tiver e o formato pedir). Inclua em cada seção uma passagem citável sempre que a fonte tiver uma para aquele assunto e o formato pedir falas: uma frase de um falante identificado em people ou rotulado na fonte — nunca de quem entrevista, pergunta ou agradece —, com quatro palavras ou mais, que traga uma posição, um número, uma razão ou uma previsão. Para uma fala de duas frases, selecione os ids seguidos das duas, na mesma parte. Selecione também uma segunda passagem citável para a mesma seção sempre que a fonte tiver, para o assunto dela, outra frase ou oração completa com informação própria (um número, uma razão, uma posição ou uma previsão) que a primeira passagem não diz, nunca um fragmento de lista nem uma passagem que repete outra evidência: até 2 passagens citáveis por seção, cada uma com os ids de todas as suas frases. Quando a fonte trouxer FALAS CURADAS (conferidas pela redação no banco de citações), prefira-as se sustentarem a parte.${copy.unlabeledAnswers ? ' Numa gravação sem rótulos de falante com uma única pessoa em people, as respostas são dela.' : ''} Um nome entre aspas não conta como citação. Não invente aspas, autoria, trechos ou informações ausentes, nem use uma evidência apenas por parecer interessante sem sustentar o intertítulo. A pessoa revisará as seleções antes da redação.

${DATA_BLOCK}

Orçamento e mínimo de citações:
{{sizing}}

Outline:
{{outline}}

Fonte com evidências [id]:
{{source}}`;
}

function introPrompt(copy: FunnelCopy): string {
  return `ABERTURA — ${copy.label} — PADRÃO SEAFOOD BRASIL
Escreva apenas a abertura (os parágrafos antes do primeiro intertítulo) da estrutura aprovada. Use introIds como foco; o outline inteiro serve para não antecipar o que vem depois.
${FIDELITY}

${HARD_NEWS}

${STYLE}

COMO ABRIR ESTE FORMATO
${copy.opening}

${PART_MECHANICS}

${REFERENCE_HEADER}
${copy.reference}

${DATA_BLOCK}

Orçamento e limites:
{{sizing}}

Estrutura aprovada:
{{outline}}

Fonte com evidências [id]:
{{source}}

CONFERÊNCIA FINAL DESTA PARTE
Retorne apenas os parágrafos da abertura, com a notícia na primeira frase, próximos de targetChars caracteres NO TOTAL, sem passar de maxChars, no padrão da Seafood Brasil e só com fatos da fonte, das pessoas e do evento.`;
}

function sectionPrompt(copy: FunnelCopy): string {
  return `SEÇÃO — ${copy.label} — PADRÃO SEAFOOD BRASIL
Escreva somente a seção atual. Retorne title exatamente igual ao título recebido e paragraphs, cada um com text e evidenceIds. Use as evidências de section.evidenceIds; a fonte completa serve para conferir o contexto, não para importar detalhes de outras seções. Leia o texto já escrito para não repetir fatos e falas, e as seções futuras para não antecipá-las.
${FIDELITY}

${HARD_NEWS}

${STYLE}

COMO ESCREVER AS SEÇÕES DESTE FORMATO
${copy.parts}

${PART_MECHANICS}

${REFERENCE_HEADER}
${copy.reference}

${DATA_BLOCK}

Orçamento:
{{sizing}}

Seção atual:
{{section}}

Texto realmente escrito até agora:
{{history}}

Seções futuras (lista vazia significa última seção):
{{futureSections}}

Fonte com evidências [id]:
{{source}}

CONFERÊNCIA FINAL DESTA PARTE
Retorne apenas os parágrafos desta seção, do fato mais importante para o menos importante, próximos de targetChars caracteres NO TOTAL, sem passar de maxChars, no padrão da Seafood Brasil e só com fatos da fonte, das pessoas e do evento.`;
}

/** The default prompt of a funnel step. */
export function defaultFunnelPrompt(format: EditorialFormat, step: FunnelStepKey): string {
  const copy = COPY[format];
  return step === 'outline' ? outlinePrompt(copy) : step === 'quotes' ? quotesPrompt(copy) : step === 'intro' ? introPrompt(copy) : sectionPrompt(copy);
}
