/**
 * Default prompts of the event-coverage funnels (formats.ts), written from 36 texts Seafood
 * Brasil's reporters published in 2026 (APAS Show, Aquishow Brasil, IFC Brasil, SENA). Each funnel
 * has its own structure (outline), opening (intro) and part (section) prompt, editable on the
 * Prompts page. The writing mechanics (budget, literal quotes, measured revisions) are the same
 * as the article's, so the engine treats every format alike; only the journalism changes.
 *
 * The style references are real published texts, cleaned of the SEO crutches and typos found in
 * them. They are marked as style only: the grounding check removes any of their names or numbers
 * that leaks into a new text.
 */
import type { EditorialFormat } from './formats.ts';

export const FUNNEL_STEP_KEYS = ['outline', 'intro', 'section'] as const;
export type FunnelStepKey = typeof FUNNEL_STEP_KEYS[number];

const FIDELITY = `JORNALISMO, NUNCA INVENÇÃO
Este texto será publicado pela redação da Seafood Brasil. Use somente fatos da fonte (source), das pessoas confirmadas (people) e dos dados do evento (event). Não invente nomes, cargos, empresas, produtos, números, preços, datas, locais, edições, temas, falas, resultados, causas ou comparações. Não use conhecimento externo, nem para completar o nome de uma empresa ou o cargo de alguém. O que a fonte não diz fica fora do texto: não presuma, não generalize, não transforme intenção em fato. A REFERÊNCIA DE ESTILO não é fonte: nenhum nome, número ou fato dela pode aparecer no texto. Um sistema confere cada número e cada nome próprio contra a fonte, as pessoas e o evento; o que não estiver lá será removido.`;

const STYLE = `PADRÃO DE ESCRITA DA SEAFOOD BRASIL
- Português do Brasil, terceira pessoa, tom informativo do jornalismo setorial do pescado. Nenhuma opinião da redação; adjetivo de elogio só dentro de fala atribuída.
- Parágrafos de 1 a 3 frases, voz ativa, frases diretas.
- Pessoas: na primeira menção, cargo e empresa com o nome completo exatamente como em people ("O diretor da [Empresa], [Nome Sobrenome], explicou que…" ou "De acordo com a gerente de marketing da [Empresa], [Nome Sobrenome], …"). Depois, só o sobrenome ou "o executivo", "a gestora", "o diretor". Sem cargo ou empresa em people, use só o nome; nunca deduza um cargo.
- Falas: citações longas e literais entre aspas curvas “ ”, copiadas de literalEvidence com o id correspondente em evidenceIds. Alterne paráfrase e citação. Dentro das aspas, preserve as palavras do entrevistado, inclusive o registro oral. Verbos de atribuição variados: explica, ressalta, detalha, destaca, aponta, pontua, comenta, conta, avalia, observa, afirma; na última fala do texto, "finalizou" ou "concluiu".
- Datas: dia da semana com o dia entre parênteses ("nesta terça-feira (20)") só quando event.today ou os dados do evento trouxerem essa data. Nunca calcule nem suponha uma data.
- Grafia da casa: País e Estado com maiúscula; valores como "R$ 99 mil"; milhar com ponto ("7.000"); local como "Foz do Iguaçu (PR)" quando a fonte ou o evento trouxerem a cidade.
- Proibido: "Em resumo", "Em síntese", "Sendo assim", "Neste sentido", "Vale ressaltar", "Vale destacar", "Diante disso" e outras muletas; conclusão moral, recapitulação, chamada para ação, pergunta retórica, promessa, link ou instrução ao leitor; repetir a mesma palavra-chave para SEO.`;

const PART_MECHANICS = `CONTRATO DE CADA PARÁGRAFO
Cada parágrafo retorna text e evidenceIds que realmente o sustentam. Aspas só podem copiar um trecho contínuo de literalEvidence, com o id correspondente em evidenceIds desse mesmo parágrafo; não mude palavras nem pontuação dentro delas. O campo context traz sínteses, que não servem como citação literal. Uma fala sem falante identificado na fonte não recebe nome. O texto inteiro deve ter ao menos articleLimits.minQuotes citações literais distintas de quatro ou mais palavras (com 0, use falas apenas quando a fonte as tiver).
Todo parágrafo termina com ponto, exclamação ou interrogação. Nunca entregue palavra cortada, oração inacabada ou parágrafo encerrado com vírgula para caber no orçamento.

ORÇAMENTO
Siga minChars, maxChars, targetChars e targetWords na raiz do orçamento: são os limites desta parte, não do texto inteiro (esses ficam em articleLimits). Quando houver outputParagraphs, retorne no máximo maxCount parágrafos, use targetCharsEach como meta por parágrafo e maxTotalChars como teto da SOMA desta parte, contando espaços. Busque a meta com informação da fonte; se o material não sustentar, escreva menos. Nunca preencha com repetição ou invenção.

REVISÃO
Se sizing.revisionFeedback estiver presente, revise APENAS esta parte, usando previousDraft como rascunho, nunca como fonte. As contagens foram medidas pelo sistema. Para ARTICLE_PART_SIZE_EXCEEDED, encurte retirando afirmações secundárias completas, sem acrescentar fatos. Para ARTICLE_PART_TOO_SHORT, desenvolva com fatos e falas desta parte que ainda não aparecem no texto, sem repetir. Para UNSUPPORTED_ARTICLE_QUOTE, copie a fala exatamente de literalEvidence com o id certo ou passe-a para discurso indireto. Para UNGROUNDED_FACT, os termos em revisionFeedback.ungroundedTerms não existem na fonte, nas pessoas nem no evento: remova-os ou escreva-os exatamente como a fonte os traz; nunca os substitua por outro dado não sustentado. Retorne somente a versão substituta desta parte.`;

type FunnelCopy = {
  label: string;
  /** Title, linha fina and parts: the outline's rules. */
  structure: string;
  /** How the opening is written. */
  opening: string;
  /** How each part after the opening is written. */
  parts: string;
  /** A real published text of the format, cleaned; style only. */
  reference: string;
};

const COPY: Record<EditorialFormat, FunnelCopy> = {
  stand: {
    label: 'COBERTURA DE ESTANDE',
    structure: `Formato: cobertura de uma empresa expositora no evento: o que ela levou, o que o porta-voz disse e o que isso diz sobre o mercado.
- title: [Empresa] + verbo no presente + foco + "na/durante a [evento]", de 50 a 75 caracteres, sem ponto final. Verbos da casa: destaca, aposta em, apresenta, lança, leva, reforça, estreia, foca em, traz. Ex. de molde: "[Empresa] aposta em [produto] durante a [Evento]".
- dek (linha fina): de 100 a 160 caracteres, sem ponto final. Caracteriza a empresa (segmento, origem, trajetória, só se a fonte ou people disserem) e acrescenta um segundo fato do material que o título não trouxe. Não repete o verbo do título.
- sections: intertítulos de 3 a 7 palavras, sintagma nominal sem verbo, muitas vezes "X e Y" ("Desafios logísticos e planos de expansão"). Arco típico: novidade no estande → mercado e desafios → expansão e perspectivas. Cada seção com evidências próprias.
- introIds: a novidade ou o objetivo da empresa no evento e a primeira fala do porta-voz.`,
    opening: `A abertura tem 2 ou 3 parágrafos e usa um destes moldes:
(a) empresa primeiro: "A [descrição] [Empresa], [aposto com trajetória ou sede, se a fonte disser], [participa da / utilizou a vitrine da] [evento] para [objetivo ou novidade]";
(b) evento primeiro: uma frase sobre o evento com os dados de event e "É o caso da [Empresa], que…";
(c) cena: "Quem anda pelos corredores da [evento]…", só quando a fonte sustentar a cena.
No segundo parágrafo, apresente o porta-voz com cargo, empresa e nome (people) e traga a primeira fala ou sua paráfrase. A primeira frase do texto nunca é uma citação.`,
    parts: `Cada seção desenvolve o assunto do seu intertítulo com as falas do porta-voz: contexto em uma frase, paráfrase, citação longa. Quando a fonte trouxer de 2 a 4 itens paralelos (especificações, modelos, fatores de um resultado), apresente cada item como um parágrafo no molde ">> Rótulo: explicação." depois de uma frase que termine com dois-pontos. Preço, capacidade e número só como a fonte disser. Na última seção, encerre com a última fala do porta-voz seguida de "finalizou" ou "concluiu"; nada depois dela.`,
    reference: `Título: BomPORTO aposta em bacalhau com sal rosa durante a APAS Show 2026
Linha fina: Indústria destacou ainda desafios atuais em trabalhar com o bacalhau, mas reforçou confiança no mercado brasileiro

A BomPORTO apresentou uma de suas principais novidades para o mercado de pescados de alto valor agregado: o lançamento do legítimo bacalhau preparado com sal rosa, grande destaque da marca na APAS Show 2026.

O diretor da empresa, Sérgio Sousa, explicou que o insumo foi escolhido por suas propriedades de alta qualidade e pureza, agregando valor comercial e refinamento gastronômico à proteína. “Nós trouxemos o bacalhau com sal rosa, ingrediente que é referência pela qualidade e pelo grau de salinidade que tem”, justificou.

[Intertítulo] Desafios operacionais e cenário de cotas

Sérgio Sousa comentou que a redução global das cotas de pesca do bacalhau e os impasses burocráticos nos portos impactaram diretamente o fluxo de abastecimento e os custos logísticos da empresa.

“De fato, a redução de cotas para nós tem sido um desafio e tem sido algo que se tem refletido pelo aumento do preço. O produto, no último ano, teve uma subida cerca de 30%”, explicou. “Por isso, a Páscoa não foi tão boa como a gente esperava.”

[Intertítulo] Identidade cultural e expansão do consumo

Para Sousa, apesar das dificuldades atuais, a aposta no mercado interno se baseia no potencial da culinária nacional para expandir o consumo do bacalhau para além das datas sazonais. “Eu acredito no mercado brasileiro, porque já estamos aqui há 23 anos. O bacalhau, pela praticidade que tem, hoje já faz parte de um grande número de brasileiros”, finalizou.`,
  },
  panel: {
    label: 'COBERTURA DE PAINEL',
    structure: `Formato: cobertura datada de uma palestra ou painel do evento: quem disse o quê, com dados atribuídos.
- title: [Instituição, palestrante ou "Painel"] + verbo (destaca, discute, debate, defende, aponta) + a tese principal, de 60 a 90 caracteres, sem ponto final.
- dek (linha fina): de 120 a 180 caracteres, sem ponto final: "Em painel sobre [tema], [Nome] apresentou…" ou "Painel [do evento] reuniu [quem] para debater [temas]". Sem repetir a cidade do título.
- sections: um intertítulo por tema ou por palestrante, na ordem em que falaram; intertítulo de 4 a 9 palavras, sintagma nominal ("Competitividade de preços e o papel da informação").
- introIds: o tema central e quem participou.`,
    opening: `A abertura tem 2 ou 3 parágrafos: o tema que pautou o dia do evento e onde (dados de event e da fonte); o nome do painel entre aspas quando a fonte ou a pauta o trouxerem; quem participou e, se houver, o mediador com cargo. Não antecipe as falas das seções.`,
    parts: `Dentro de cada seção: contexto em uma frase → palestrante com cargo e empresa (primeira menção) e paráfrase da ideia → citação longa → ponte → segunda citação. Dados sempre atribuídos ("Segundo o palestrante", "de acordo com os dados apresentados pela [instituição]"). Quando a fonte listar ferramentas, ações ou números paralelos, use parágrafos ">> Rótulo: explicação." depois de uma frase com dois-pontos. Na última seção, encerre com uma fala e "concluiu".`,
    reference: `Título: Painel discute desafios de consumo e estratégias para o mercado de pescado
Linha fina: Painel reuniu representantes da indústria e do varejo para debater o comportamento do consumidor, a competitividade das proteínas e a estruturação da cadeia produtiva

Neste primeiro dia, o “Painel de Líderes – Desafios, perspectivas e estratégias para o mercado de pescado” reuniu executivos da indústria e do varejo nacional. O debate abordou desde o impacto da perda do poder de compra na escolha das proteínas até a reestruturação do atendimento ao consumidor no ponto de venda.

[Intertítulo] Competitividade de preços e o papel da informação

O poder de aquisição do consumidor brasileiro segue pressionado, alterando a dinâmica de escolha nos supermercados. Danilo Souza Alves, diretor da Friocenter Pescados, destacou que o fator financeiro determina diretamente a composição da cesta de compras no País.

“A gente percebe que o poder de compra do brasileiro tem caído cada vez mais. O brasileiro realmente não escolhe o que ele gosta, o que ele quer. Ele escolhe o que cabe dentro do seu bolso”, observou Alves.

[Intertítulo] Mudança no comportamento do consumidor e decisões no varejo

Meg Felippe, diretora de varejo da Frescatto Company, explicou que a compra de peixe no supermercado é predominantemente emocional e intuitiva, sendo o preço o fator de maior atrito racional.

“Antes era muito comum a dona de casa chegar e dizer ‘eu vim comprar uma tilápia’. Hoje as pessoas têm mais um comportamento de ocasião”, afirmou a diretora da Frescatto Company.`,
  },
  awards: {
    label: 'PREMIAÇÃO',
    structure: `Formato: os vencedores de um prêmio entregue no evento, exatamente como constam no material oficial.
- title: "[Prêmio] revela vencedores na [evento]" ou "[Evento] entrega [Prêmio]", de 55 a 75 caracteres, sem ponto final.
- dek (linha fina): de 100 a 140 caracteres, sem ponto final: quando foi a cerimônia, o que o prêmio reconheceu e as categorias, se a fonte disser.
- sections: uma seção por categoria, intertítulo "Categoria [Nome]" exatamente com o nome da categoria na fonte. Se a fonte tiver mais categorias do que seções, agrupe categorias vizinhas sem omitir nenhum vencedor.
- introIds: o nome do prêmio, a finalidade e a condução da cerimônia, se a fonte trouxer.`,
    opening: `A abertura tem 1 a 3 parágrafos: "A [cerimônia/noite] da [evento] foi marcada pela entrega do [Prêmio]", com a finalidade do prêmio só se a fonte disser; depois, quem conduziu, o formato das colocações e quem entregou os troféus, se a fonte trouxer; uma fala da organização apenas se existir na fonte. Termine a abertura com a frase "Confira a seguir os vencedores de cada categoria:".`,
    parts: `Cada vencedor é um parágrafo no molde ">> [Colocação]: [Nome], da [Instituição ou empresa] | Projeto: [Título]." com exatamente os dados da fonte: não complete instituição, estado, projeto ou colocação ausentes, não corrija grafias e não invente categorias. Sem comentários entre os vencedores e sem fecho depois da lista.`,
    reference: `Título: Prêmio Inovação Aquícola revela vencedores na Aquishow Brasil 2026
Linha fina: Cerimônia no primeiro dia da feira reconheceu os melhores projetos nas categorias Academia, Produção e Sustentabilidade

A noite de abertura da Aquishow Brasil 2026 foi marcada pela celebração do desenvolvimento tecnológico e científico do setor. Ao final do primeiro dia de feira, foi realizada a cerimônia de entrega do Prêmio Inovação Aquícola Aquishow Brasil 2026.

Conduzida por Marilsa Fernandes, coordenadora geral da Aquishow, a premiação distribuiu reconhecimentos em formato de Ouro, Prata e Bronze.

Confira a seguir os vencedores de cada categoria:

[Intertítulo] Categoria Academia

>> Ouro: Guilherme Wolff Bueno, da UNESP Registro (SP) | Projeto: Documentário Entre Redes e Desafios da Piscicultura Familiar.

>> Prata: Elizângela de França Carneiro Carvalho, da Embrapa Pesca e Aquicultura.`,
  },
  opening: {
    label: 'ABERTURA',
    structure: `Formato: a cerimônia de abertura do evento, discurso por discurso, com os anúncios em primeiro plano.
- title: o anúncio mais forte antes do rito, de 60 a 90 caracteres, sem ponto final ("Cerimônia de abertura traz anúncio de [medida] e [segundo fato]").
- dek (linha fina): de 100 a 170 caracteres, sem ponto final: um segundo anúncio e os nomes de quem discursou.
- sections: uma seção por anúncio ou discurso, na ordem do palco; o intertítulo nomeia o anúncio, não o orador ("Marco no licenciamento ambiental").
- introIds: quando, onde e qual edição, e quem compôs a mesa.`,
    opening: `A abertura tem 1 ou 2 parágrafos: "A abertura oficial da [edição] da [evento], realizada [dia] em [cidade], marcou o início…", com edição, dia e cidade somente se estiverem na fonte ou no evento. Não antecipe os anúncios das seções.`,
    parts: `Cada seção segue o discurso: quem fala na primeira menção (autoridade com cargo antes do nome e sigla do órgão quando a fonte trouxer: "o ministro da Pesca e Aquicultura (MPA), [Nome]"; organizador com nome primeiro: "[Nome], presidente do [evento]") → paráfrase do anúncio → citação → detalhe técnico ou número atribuído → citação. Retomadas: "o titular da pasta", "o dirigente". Na última seção, encerre com o último anúncio pertinente, sem recapitular.`,
    reference: `Título: Cerimônia oficial de abertura traz anúncio de nova regra ambiental e metas para a tilápia
Linha fina: Candidatura para sediar o LACQUA 2027 e revisão da Conama 413 marcaram os discursos de Altemir Gregolin e do ministro da Pesca e Aquicultura

A abertura oficial da 8ª edição do International Fish Congress & Fish Expo Brasil (IFC Brasil 2026), realizada nesta quarta-feira (2) em Foz do Iguaçu (PR), marcou o início das atividades do evento, com autoridades e lideranças cooperativas da cadeia.

[Intertítulo] Propósito do evento e candidatura internacional

Em seu discurso de abertura, Altemir Gregolin, presidente do IFC Brasil, relembrou a trajetória do congresso desde a sua criação em 2019. “O IFC Brasil nasceu com um propósito: oportunizar melhores condições para o desenvolvimento do setor no País”, declarou.

[Intertítulo] Marco no licenciamento ambiental

Convidado para discursar na cerimônia, o ministro da Pesca e Aquicultura (MPA), Édipo Araújo, classificou o dia como histórico para a atividade, com a aprovação da revisão da Resolução nº 413/2009 pelo Conselho Nacional do Meio Ambiente (Conama).

“Tivemos dez anos de discussões e agora a aquicultura será licenciada pelo volume de produção. Isso desburocratiza o processo, principalmente para a aquicultura familiar”, anunciou Araújo.`,
  },
  note: {
    label: 'NOTA CURTA',
    structure: `Formato: nota curta, um fato só, sem intertítulo.
- title: o fato com verbo no presente, de 50 a 80 caracteres, sem ponto final.
- dek (linha fina): de 80 a 140 caracteres, sem ponto final, com um detalhe que o título não traz.
- sections: use o número de seções da pauta apenas para organizar o contexto; os títulos das seções não serão publicados.
- introIds: o fato central.`,
    opening: `A abertura é o lide em 1 parágrafo: quem, o quê, quando e onde, em uma ou duas frases, sem citação na primeira frase.`,
    parts: `Desenvolva o contexto em 1 ou 2 parágrafos curtos: um detalhe do fato, uma fala literal se existir na fonte, e o dado que completa a informação. Sem conclusão, sem chamada e sem intertítulo.`,
    reference: `Título: Trident Seafoods conquista premiação para Food Service na SENA 2026
Linha fina: Os novos nuggets de polaca do Alasca foram eleitos o melhor lançamento do segmento

A norte-americana Trident Seafoods venceu a categoria "Melhor Novo Produto para Food Service" no Seafood Excellence Awards 2026. O resultado foi revelado na Seafood Expo North America (SENA).

Feitos com polaca do Alasca, os nuggets têm cobertura empanada neutra e crocante, projetada para absorver diferentes molhos sem perder a textura. Segundo a empresa, o produto mantém a crocância por até uma hora após o preparo.`,
  },
};

const DATA_BLOCK = `Pauta:
{{brief}}

Evento e data de hoje (dados digitados pela redação):
{{event}}

Pessoas confirmadas (nome, cargo e empresa como devem aparecer):
{{people}}`;

function outlinePrompt(copy: FunnelCopy): string {
  return `ESTRUTURA — ${copy.label} — PADRÃO SEAFOOD BRASIL
Planeje o texto sem redigi-lo. Retorne title, dek, introIds e sections com title e evidenceIds.
${FIDELITY}

${copy.structure}

Use exatamente o número de seções da pauta (brief.sections), na ordem mais clara. Selecione até 2 ids para a abertura e de 1 a 20 por seção, somente ids presentes na fonte e sem repetir ids entre partes. Distribua as passagens com falas literais entre as seções, para que o texto alcance o mínimo de citações do formato. O título, a linha fina e os intertítulos só podem conter fatos sustentados pela fonte, pelas pessoas ou pelo evento; um nome ou número de fora será removido.

${DATA_BLOCK}

Fonte com evidências [id]:
{{source}}`;
}

function introPrompt(copy: FunnelCopy): string {
  return `ABERTURA — ${copy.label} — PADRÃO SEAFOOD BRASIL
Escreva apenas a abertura (os parágrafos antes do primeiro intertítulo) da estrutura aprovada. Use introIds como foco; o outline inteiro serve para não antecipar o que vem depois.
${FIDELITY}

${STYLE}

COMO ABRIR ESTE FORMATO
${copy.opening}

${PART_MECHANICS}

REFERÊNCIA DE ESTILO (não é fonte; nenhum fato dela pode ser usado)
${copy.reference}

${DATA_BLOCK}

Orçamento e limites:
{{sizing}}

Estrutura aprovada:
{{outline}}

Fonte com evidências [id]:
{{source}}

CONFERÊNCIA FINAL DESTA PARTE
Retorne apenas os parágrafos da abertura, próximos de targetChars caracteres NO TOTAL, sem passar de maxChars, no padrão da Seafood Brasil e só com fatos da fonte, das pessoas e do evento.`;
}

function sectionPrompt(copy: FunnelCopy): string {
  return `SEÇÃO — ${copy.label} — PADRÃO SEAFOOD BRASIL
Escreva somente a seção atual. Retorne title exatamente igual ao título recebido e paragraphs, cada um com text e evidenceIds. Use as evidências de section.evidenceIds; a fonte completa serve para conferir o contexto, não para importar detalhes de outras seções. Leia o texto já escrito para não repetir fatos e falas, e as seções futuras para não antecipá-las.
${FIDELITY}

${STYLE}

COMO ESCREVER AS SEÇÕES DESTE FORMATO
${copy.parts}

${PART_MECHANICS}

REFERÊNCIA DE ESTILO (não é fonte; nenhum fato dela pode ser usado)
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
Retorne apenas os parágrafos desta seção, próximos de targetChars caracteres NO TOTAL, sem passar de maxChars, no padrão da Seafood Brasil e só com fatos da fonte, das pessoas e do evento.`;
}

/** The default prompt of a funnel step. */
export function defaultFunnelPrompt(format: EditorialFormat, step: FunnelStepKey): string {
  const copy = COPY[format];
  return step === 'outline' ? outlinePrompt(copy) : step === 'intro' ? introPrompt(copy) : sectionPrompt(copy);
}
