import type { JSONContent } from "@tiptap/react";
import type { ArticleVersion } from "@/components/editor/article-document";

export type Stage = "source" | "article" | "carousel" | "ready";
export type Slide = { title: string; body: string };
export type Production = {
  id: string;
  title: string;
  source: string;
  participants: string;
  context: string;
  transcript: string;
  article: string;
  articleDocument?: JSONContent;
  articleVersions?: ArticleVersion[];
  slides: Slide[];
  stage: Stage;
  articleApproved: boolean;
  carouselApproved: boolean;
  owner: string;
  updated: string;
};

export const stages: { id: Stage; label: string; action: string }[] = [
  { id: "source", label: "Transcrição", action: "Conferir material" },
  { id: "article", label: "Artigo", action: "Revisar artigo" },
  { id: "carousel", label: "Carrossel", action: "Revisar slides" },
  { id: "ready", label: "Concluídos", action: "Ver entrega" },
];

export const sampleTranscript = `Entrevistadora: Onde a inteligência artificial mais ajuda uma equipe editorial?

Convidado: No tempo que a gente recupera para fazer as perguntas certas. Organizar uma transcrição, localizar uma ideia e preparar um primeiro rascunho são tarefas que podem ser aceleradas. A decisão sobre o que merece ser publicado continua sendo editorial.

Entrevistadora: E qual é o cuidado mais importante nesse processo?

Convidado: Manter a fonte por perto. O editor precisa conseguir voltar à conversa original, conferir o contexto e entender de onde saiu cada afirmação. Um texto fluente não é necessariamente um texto correto.

Entrevistadora: Como isso muda a distribuição do conteúdo?

Convidado: Uma boa entrevista pode virar um artigo e um carrossel. Mas cada formato tem uma função. O artigo aprofunda; o carrossel abre a conversa. Adaptar não é simplesmente cortar o mesmo texto em pedaços menores.`;

const sampleArticle = `A inteligência artificial começa a mudar a rotina das redações pelas tarefas que antecedem a publicação. Organizar transcrições e preparar rascunhos libera tempo para o trabalho de apuração, contexto e revisão.

Na entrevista de demonstração, o ponto central é a permanência da decisão editorial. A tecnologia pode acelerar a produção, mas a equipe continua responsável por escolher o enfoque e conferir cada afirmação.

A fonte precisa acompanhar o texto

Ter a transcrição acessível durante a revisão permite comparar o rascunho com a conversa original. Essa proximidade ajuda a preservar o contexto e evita que a fluência do texto seja confundida com precisão.

Uma conversa, diferentes formatos

O reaproveitamento também exige escolhas. Enquanto o artigo desenvolve uma ideia em profundidade, o carrossel apresenta seus pontos principais e convida o público a continuar a leitura. Cada formato pede uma construção própria.

O resultado esperado é uma rotina em que a automação organiza o trabalho e a equipe editorial mantém o controle sobre o que chega ao público.`;

const sampleArticleDocument: JSONContent = {
  type: "doc",
  content: sampleArticle.split("\n\n").map((text, index) => ({
    type: index === 2 || index === 4 ? "heading" : "paragraph",
    ...(index === 2 || index === 4 ? { attrs: { level: 2 } } : {}),
    content: [{ type: "text", text }],
  })),
};

export function draftSlides(title: string, article: string): Slide[] {
  const paragraphs = article.split(/\n+/).filter((text) => text.trim());
  return [
    { title, body: "Uma conversa para entender o que está mudando." },
    { title: "O ponto de partida", body: paragraphs[0]?.slice(0, 240) ?? "" },
    { title: "O que merece atenção", body: paragraphs[1]?.slice(0, 240) ?? "" },
    { title: "Para continuar a conversa", body: "Leia o artigo completo e compartilhe sua perspectiva." },
  ];
}

export const exampleInput = {
  title: "IA na redação: mais tempo para as boas perguntas",
  source: "Entrevista · Futuro do conteúdo",
  participants: "Marina Lopes e Rafael Dias",
  context: "Um olhar sobre o uso de IA na produção editorial, com foco em revisão humana e contexto.",
  transcript: sampleTranscript,
};

export function makeDraft(input: typeof exampleInput): Production {
  const article = input.transcript === sampleTranscript ? sampleArticle : input.transcript;
  return {
    ...input, id: "", article, articleDocument: input.transcript === sampleTranscript ? sampleArticleDocument : undefined, slides: [], stage: "article",
    articleApproved: false, carouselApproved: false, owner: "João Vitor", updated: "Agora",
  };
}

const examples: [string, string, Stage, string, string][] = [
  ["001", exampleInput.title, "article", "Marina Lopes", "Há 12 min"],
  ["002", "A força das comunidades na construção de marcas", "carousel", "Rafael Dias", "Há 35 min"],
  ["003", "Por que os encontros presenciais continuam relevantes", "source", "João Vitor", "Há 1 h"],
  ["004", "Confiança: o valor de ouvir antes de comunicar", "article", "Clara Souto", "Há 2 h"],
  ["005", "Uma entrevista, muitas formas de contar", "ready", "Marina Lopes", "Ontem"],
  ["006", "Da audiência à conversa: conteúdo que aproxima", "carousel", "João Vitor", "Ontem"],
];

export const demoProductions: Production[] = examples.map(([id, title, stage, owner, updated], index) => {
  const transcript = index === 0 ? sampleTranscript : `Entrevistadora: Qual é o ponto principal de “${title}”?\n\nConvidado: A qualidade da conversa depende da escuta. Entender as perguntas e necessidades das pessoas é o primeiro passo para criar conteúdo relevante.\n\nEntrevistadora: Como levar isso para a prática?\n\nConvidado: Começar por uma conversa real, preservar seu contexto e escolher o formato que melhor apresenta a ideia.`;
  const article = index === 0 ? sampleArticle : `O tema “${title}” coloca a escuta no centro da produção de conteúdo. Compreender as dúvidas das pessoas ajuda a definir o que vale a pena aprofundar.\n\nNa conversa de demonstração, a proposta é começar por perguntas reais e manter o contexto das respostas. A qualidade do material depende tanto da apuração quanto das escolhas feitas na revisão.\n\nA distribuição é uma etapa dessa construção. Um artigo pode explorar os argumentos, enquanto um carrossel apresenta os pontos principais. O formato muda, mas a fidelidade à conversa precisa permanecer.`;
  return {
    ...exampleInput, id, title, transcript, article, articleDocument: index === 0 ? sampleArticleDocument : undefined, stage, owner, updated,
    context: index === 0 ? exampleInput.context : `Explorar o tema “${title}”, preservando o contexto da entrevista.`,
    source: index === 0 ? exampleInput.source : "Entrevista · Conversas sobre conteúdo",
    slides: stage === "carousel" || stage === "ready" ? draftSlides(title, article) : [],
    articleApproved: stage === "carousel" || stage === "ready", carouselApproved: stage === "ready",
  };
});
