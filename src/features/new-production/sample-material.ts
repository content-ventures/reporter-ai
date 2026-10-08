import type { ArticleSize, SourceOrigin } from '../../domain/index.ts';

/**
 * "Usar exemplo": a fictional interview for demos of Nova produção. Three speakers in
 * "Nome: fala" lines with a few [hh:mm:ss] stamps: two of them are people of the workspace
 * (matched by name in "Falantes"), the third becomes a new person. Questions end with "?",
 * so the extractive simulation turns them into headings. Every person and number is invented.
 */

export const SAMPLE_TITLE = 'Tendências do verão 2027';

export const SAMPLE_ORIGIN: SourceOrigin = 'interview';

export const SAMPLE_ANGLE = 'Foco no que muda para o lojista: reposição curta, grade bem montada e argumento de venda.';

export const SAMPLE_SECTIONS = 3;

export const SAMPLE_SIZE: ArticleSize = 'standard';

/** Label that is not a workspace person yet ("Nova pessoa" in Falantes). */
export const SAMPLE_NEW_SPEAKER = 'Lucas Ferraz';

export const SAMPLE_TRANSCRIPT = [
  '[00:00:06] Rafael Dias: Beatriz, Lucas, obrigado por virem até o estúdio na semana da feira. Beatriz, pra começar: o que vai estar no pé das pessoas no verão de 2027?',
  'Beatriz Almeida: A palavra que eu mais tenho ouvido nas fábricas é leveza. Não é só o peso do sapato, é leveza visual também. Tiras mais finas, solados com menos volume, cores que lembram material natural. Depois de três temporadas de solado alto e tratorado, o consumidor está pedindo um sapato que pareça fácil de usar. Eu brinco que o verão de 2027 é o verão do sapato que não grita.',
  'Rafael Dias: E isso já aparece nos pedidos, Lucas?',
  'Lucas Ferraz: Aparece, e com números. Na nossa rede, que tem 40 lojas no Nordeste, a rasteira de tira fina cresceu 28% no último verão, enquanto o tênis de solado alto caiu pela primeira vez em quatro anos. Eu ainda compro solado alto, mas compro menos e com grade mais curta. O lojista aprendeu a não apostar tudo numa forma só.',
  'Rafael Dias: Beatriz, como uma fábrica traduz leveza em produto sem perder margem?',
  'Beatriz Almeida: Esse é o ponto mais difícil. Leveza costuma custar caro, porque material leve e resistente é mais caro e porque tira fina exige uma costura mais precisa. O que eu proponho para as fábricas é trabalhar a leveza na forma e no desenho antes de trabalhar no material. Uma palmilha bem desenhada, um contraforte mais baixo, uma tira que abraça o pé no lugar certo. Isso não aumenta custo, aumenta tempo de modelagem. E tempo de modelagem é o investimento que mais volta.',
  '[00:04:12] Rafael Dias: E as cores? O que muda na cartela?',
  'Beatriz Almeida: Sai o branco ótico e entra o off-white, o areia, o tom de palha. O caramelo continua forte. E tem uma cor de destaque que eu vejo em quase todas as coleções que visitei: um verde de folha seca, meio oliva. Ele funciona bem com couro natural e conversa com a ideia de material honesto, que é outra coisa que o consumidor está valorizando.',
  'Rafael Dias: Material honesto. O que isso quer dizer na prática?',
  'Beatriz Almeida: Quer dizer mostrar do que o sapato é feito. Couro com a textura aparente, borda pintada à mão, sola de borracha que parece borracha. Durante muito tempo a indústria escondeu o material atrás de verniz e de acabamento brilhante. Agora o consumidor quer tocar e entender. E isso abre espaço para a fábrica contar a própria história: de onde vem o couro, quem costura, quanto tempo leva.',
  'Lucas Ferraz: E essa história vende, Rafael. A gente começou a colocar uma etiqueta simples na caixa, dizendo a cidade da fábrica e o tipo de couro. As vendedoras usam isso na conversa com o cliente. Num teste em seis lojas, o modelo com etiqueta vendeu 15% a mais do que o mesmo modelo sem etiqueta. Não é mágica, é argumento de venda que custa centavos.',
  '[00:09:30] Rafael Dias: Lucas, o que o comprador mais cobra das fábricas hoje?',
  'Lucas Ferraz: Prazo e reposição. O consumidor decide a compra mais perto da estação, então eu compro menos na pré-venda e quero repor rápido o que gira. Fábrica que me entrega a reposição em três semanas ganha espaço na minha loja. Fábrica que precisa de noventa dias para repor fica só com o pedido de lançamento. E tem outra coisa: grade bem montada. Eu perdi muita venda de número 34 e 40 porque a fábrica mandou grade padrão.',
  'Rafael Dias: Beatriz, as fábricas estão preparadas para essa reposição curta?',
  'Beatriz Almeida: As que trabalham com lotes menores, sim. Eu vejo fábricas médias reorganizando a produção em células, cada uma responsável por uma família de modelos. Isso permite produzir 200 pares de um modelo sem parar a linha inteira. Não é uma mudança barata, mas quem fez está conseguindo atender exatamente o que o Lucas descreveu.',
  'Rafael Dias: E a sustentabilidade, sai do discurso em 2027?',
  'Beatriz Almeida: Precisa sair. O consumidor já não acredita em selo verde sem explicação. O que funciona é dado concreto: quanto de material reciclado tem na sola, quanto de água o curtume economizou, se a caixa é de papel reciclado. Uma fábrica com quem trabalho trocou a caixa por um modelo sem cola e sem impressão colorida e reduziu o custo da embalagem em 9%. Sustentabilidade que reduz custo é a que fica.',
  'Lucas Ferraz: Do lado da loja, eu só consigo vender sustentabilidade se a vendedora entender. Se a informação for complicada, ela não repete. Então eu peço para as fábricas uma frase. Uma frase que a vendedora consiga dizer em cinco segundos para o cliente.',
  'Rafael Dias: Lucas, e o preço? O consumidor aceita pagar mais por esse sapato?',
  'Lucas Ferraz: Aceita, até um ponto. Na nossa rede, o par de couro com etiqueta de origem sustenta um preço uns 10% acima do similar sem história. Passou disso, ele espera a liquidação. O que eu peço para a fábrica é segurar o preço de reposição durante a estação. Se a segunda compra chega mais cara que a primeira, eu tiro o modelo da vitrine.',
  'Beatriz Almeida: E a fábrica consegue segurar esse preço quando planeja a compra de couro para a estação inteira. Quem compra material pedido a pedido fica refém do câmbio e repassa a diferença para o lojista no pior momento.',
  '[00:12:05] Rafael Dias: Lucas, e a venda online? Ela muda a grade que você compra?',
  'Lucas Ferraz: Muda bastante. No site, o cliente compra pelo número e pela foto, então o modelo precisa ter grade completa e foto honesta. Quando falta o 35 no site, a pessoa não troca de modelo, ela vai embora. Hoje 18% da nossa venda passa pelo site, e foi o site que me ensinou a montar grade: eu olho o que esgotou primeiro na internet e reponho isso nas lojas da mesma região.',
  'Beatriz Almeida: E a foto honesta volta para a ideia de material. Se o couro tem textura, a foto precisa mostrar a textura. Muita fábrica ainda manda foto de catálogo com tudo liso e brilhante, e o cliente devolve o sapato porque chegou diferente do que viu. Devolução no online custa caro para todo mundo.',
  'Rafael Dias: Beatriz, o conforto ainda é argumento de venda em 2027?',
  'Beatriz Almeida: É o argumento que nunca sai. O que muda é como ele aparece. Antes o conforto vinha escondido numa palmilha grossa. Agora ele aparece no desenho: uma forma mais larga na frente, um salto de quatro centímetros em vez de oito, uma tira com elástico embutido. A cliente não quer escolher entre bonito e confortável, e a fábrica que entende isso vende o ano inteiro.',
  'Lucas Ferraz: E a vendedora precisa conseguir provar isso no pé da cliente. Eu peço para cada loja ter um par de prova de cada modelo de conforto, em dois números. Parece pouco, mas nas lojas onde fizemos isso a conversão do modelo subiu 12%.',
  'Rafael Dias: E a feira, Lucas? Ainda é onde você fecha a compra?',
  'Lucas Ferraz: É onde eu começo a compra, não onde eu fecho. Na feira eu vejo a coleção, toco no material e converso com quem desenhou. O pedido grande eu fecho depois, com os números da minha rede na mão. A fábrica que me manda a ficha técnica e o preço de reposição em até uma semana depois da feira normalmente leva o pedido.',
  'Beatriz Almeida: Por isso eu digo para as fábricas levarem menos modelos para o estande e mais informação. Peso do par, origem do couro, prazo de reposição. O comprador hoje chega na feira com a planilha aberta no celular, e quem não responde na hora fica para depois.',
  'Rafael Dias: Beatriz, que material novo você vê chegando para o verão?',
  'Beatriz Almeida: A borracha com parte de material reciclado já está madura. Ela tem o mesmo desempenho da borracha comum e custa quase o mesmo. Também vejo o couro curtido com tanino vegetal ganhando espaço nas fábricas médias, porque ele envelhece bonito e combina com essa estética de material aparente. O cuidado é com o prazo: o curtimento vegetal leva mais tempo, então a compra do couro precisa ser planejada com dois meses a mais de folga.',
  '[00:16:48] Rafael Dias: Para terminar: um conselho para quem vai desenhar a coleção agora?',
  'Beatriz Almeida: Desenhe menos modelos e desenhe melhor. Uma coleção enxuta, com três ou quatro formas bem resolvidas e boas variações de cor e material, vende mais do que uma coleção com quarenta modelos que ninguém consegue explicar. E vá para a loja. Passe um sábado inteiro do lado de uma vendedora. Você vai voltar com metade da coleção redesenhada.',
  'Lucas Ferraz: E converse com o comprador antes de fechar a cartela, não depois. A gente sabe o que encalhou no ano passado. Essa informação é de graça e quase ninguém pergunta.',
  'Rafael Dias: Beatriz, Lucas, obrigado pela conversa.',
].join('\n\n');
