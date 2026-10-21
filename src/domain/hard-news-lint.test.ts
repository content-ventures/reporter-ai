import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headingBlock, paragraphBlock } from './article.ts';
import type { ArticleBody } from './article.ts';
import { hardNewsLint, leadIssues } from './hard-news-lint.ts';
import type { HardNewsIssueCode, HardNewsLintOptions } from './hard-news-lint.ts';

/** A body from a title and parts: a string is a paragraph, `{ heading }` an intertítulo. */
function article(title: string, parts: readonly (string | { heading: string })[]): ArticleBody {
  return { type: 'article', title, blocks: parts.map((part, index) => typeof part === 'string'
    ? paragraphBlock(`b${index}`, part) : headingBlock(`b${index}`, part.heading)) };
}
const codes = (body: ArticleBody, options: HardNewsLintOptions = { minQuotes: 0 }) => hardNewsLint(body, options).issues.map(issue => issue.code);
const details = (body: ArticleBody, code: HardNewsIssueCode, options: HardNewsLintOptions = { minQuotes: 0 }) =>
  hardNewsLint(body, options).issues.filter(issue => issue.code === code).map(issue => issue.detail);

/** The stand style reference of the funnel prompts (an invented text). */
const STAND = article('Pescados Litoral lança tilápia defumada em porções de 200 gramas na Feira Modelo 2026', [
  'A Pescados Litoral lançou na Feira Modelo 2026 uma tilápia defumada em porções de 200 gramas, voltada ao varejo. O produto chega às gôndolas do Sudeste em julho, com preço sugerido de R$ 24,90, segundo a empresa.',
  'O diretor comercial da empresa, Ricardo Lemos, disse que a porção menor atende a um pedido dos supermercados. “O cliente quer levar uma refeição para duas pessoas, não um quilo de peixe”, afirmou.',
  { heading: 'Meta de vendas e capacidade da fábrica' },
  'Segundo Lemos, a linha deve responder por 15% das vendas de congelados no primeiro ano. A fábrica passou a operar em dois turnos para atender os pedidos.',
  '“Dobramos a capacidade de defumação em março”, disse o diretor.',
  { heading: 'Exportação em estudo' },
  'A empresa estuda vender o produto ao Chile a partir de 2027, de acordo com Lemos. “O pedido de habilitação sanitária sai ainda este ano”, afirmou. A Pescados Litoral diz ser a única indústria do Sudeste a defumar tilápia em porções individuais.',
]);
const STAND_OPTIONS = { minQuotes: 2, eventName: 'Feira Modelo 2026', quotableSections: [true, true] };

test('a hard-news text passes every rule', () => {
  assert.deepEqual(hardNewsLint(STAND, STAND_OPTIONS).issues, []);
});

test('the lead is the news', () => {
  assert.deepEqual(leadIssues('O primeiro dia do IFC Brasil 2026 teve o painel sobre exportação de tilápia.'), ['LEAD_RITUAL']);
  assert.deepEqual(leadIssues('A Hecke Alimentos participa da APAS Show 2026 com uma linha de pescados congelados.'), ['LEAD_RITUAL']);
  assert.deepEqual(leadIssues('A APAS Show 2026 recebeu 900 expositores em São Paulo.', 'APAS Show 2026'), ['LEAD_RITUAL']);
  assert.deepEqual(leadIssues('Na APAS Show 2026, a Hecke lançou uma linha de congelados.', 'APAS Show 2026'), ['LEAD_RITUAL']);
  assert.deepEqual(leadIssues('A APAS Show 2026 recebeu 900 expositores em São Paulo.'), [], 'the event rule needs the event name');
  assert.deepEqual(leadIssues('A Hecke lançou na APAS Show 2026 uma linha de congelados.', 'APAS Show 2026'), []);
  const lead = (count: number) => ['A', 'cooperativa', 'anunciou', ...Array.from({ length: count - 3 }, () => 'investimentos')].join(' ') + '.';
  assert.deepEqual(leadIssues(lead(41)), ['LEAD_TOO_LONG']);
  assert.deepEqual(leadIssues(lead(40)), []);
  const quoted = 'O diretor disse que “a fábrica vai dobrar a produção” na feira.';
  assert.deepEqual(leadIssues(quoted), ['LEAD_QUOTE']);
  assert.deepEqual(leadIssues(quoted, undefined, () => false), []);
  assert.deepEqual(leadIssues('A empresa lançou o “Linha Mar” na feira.'), [], 'a short name in quotes is no quotation');
  const body = article('Cooperativa anuncia investimento', ['A abertura da feira reuniu 300 produtores. O resto segue.']);
  assert.deepEqual(details(body, 'LEAD_RITUAL'), ['A abertura da feira reuniu 300 produtores.']);
});

test('soft verbs, but a brand called marca passes', () => {
  const soft = (title: string) => details(article(title, ['A empresa lançou o produto.']), 'HEADLINE_SOFT_VERB');
  assert.deepEqual(soft('Netto destaca a força do pescado no varejo'), ['destaca']);
  assert.deepEqual(soft('Painel discute o futuro da tilápia e aposta em exportação'), ['discute', 'aposta em']);
  assert.deepEqual(soft('A marca Rio lança tilápia em porções'), []);
  assert.deepEqual(soft('Empresa marca 30 anos com nova fábrica'), ['marca']);
  assert.deepEqual(codes(article('x'.repeat(91), ['A empresa lançou o produto.'])), ['HEADLINE_TOO_LONG']);
  assert.deepEqual(codes(article('x'.repeat(90), ['A empresa lançou o produto.'])), []);
});

test('boundaries around accented letters', () => {
  assert.deepEqual(codes(article('Empresa lança selo', ['A empresa vende o único produto do país com selo.'])), ['SELF_CLAIM_UNATTRIBUTED']);
  assert.deepEqual(codes(article('Empresa lança selo', ['O unicórnio da marca chega ao varejo.'])), []);
  assert.deepEqual(details(article('Empresa lança selo', ['A empresa lança o produto amanhã, em São Paulo.']), 'RELATIVE_DATE'), ['amanhã']);
  assert.deepEqual(codes(article('Empresa lança selo', ['Montemos a linha em São Paulo, disse o diretor.'])), []);
});

test('evaluative attribution outside quotes only', () => {
  const body = article('Fábrica dobra a produção', ['O diretor ressaltou que a fábrica cresceu. “A gente destaca o sabor do peixe”, disse.']);
  assert.deepEqual(details(body, 'EVALUATIVE_ATTRIBUTION'), ['ressaltou']);
  const { metrics } = hardNewsLint(body, { minQuotes: 0 });
  assert.equal(metrics.evaluative, 1);
  assert.equal(metrics.neutral, 1);
});

test('self-claims need attribution and never sit in the headline', () => {
  assert.deepEqual(codes(article('Pescados Litoral, a única indústria a defumar tilápia, lança porção', ['A empresa lançou a porção.'])), ['HEADLINE_SELF_CLAIM']);
  const claims = (text: string) => details(article('Empresa lança porção', [text]), 'SELF_CLAIM_UNATTRIBUTED');
  assert.deepEqual(claims('A empresa é pioneira no defumado.'), ['A empresa é pioneira no defumado.']);
  assert.deepEqual(claims('A empresa é líder de mercado no Sudeste.'), ['A empresa é líder de mercado no Sudeste.']);
  assert.deepEqual(claims('A empresa diz ser pioneira no defumado.'), []);
  assert.deepEqual(claims('Segundo o diretor, a empresa é líder de mercado.'), []);
  assert.deepEqual(claims('“Somos pioneiros no defumado”, disse Lemos.'), []);
});

test('promotional words and crutches; award names pass', () => {
  const body = article('Empresa lança produto', ['A empresa apresentou um produto inovador e de alta qualidade. Confira os vencedores.']);
  const { metrics } = hardNewsLint(body, { minQuotes: 0 });
  assert.deepEqual(metrics.promotional, ['inovador', 'de alta qualidade']);
  assert.deepEqual(metrics.crutches, ['Confira']);
  assert.deepEqual(codes(body), ['PROMOTIONAL_WORD', 'PROMOTIONAL_WORD', 'CRUTCH']);
  assert.deepEqual(codes(article('Cooperativa vence prêmio', ['A Cooperativa Rio Claro venceu o Prêmio Excelência em Aquicultura.'])), []);
  assert.deepEqual(codes(article('Empresa lança produto', ['A empresa lançou o produto.', '“O produto é um sucesso de vendas”, disse o diretor.'])), []);
});

test('quotes: minimum, repeats, long quotes, sections without one', () => {
  const body = article('Pescados Litoral dobra a produção de tilápia', [
    'A Pescados Litoral dobrou a produção de tilápia. “Vamos dobrar a produção neste ano”, disse Lemos.',
    { heading: 'Mercado' },
    'Segundo Lemos, “vamos dobrar a produção neste ano”. O “carro-chefe” segue.',
    { heading: 'Exportação' },
    '“Primeira frase do diretor aqui. Segunda frase do diretor. Terceira frase sobre exportação”, afirmou.',
    { heading: 'Planos' },
    'A empresa estuda o Chile.',
  ]);
  const { metrics, issues } = hardNewsLint(body, { minQuotes: 3, quotableSections: [true, false, true] });
  assert.deepEqual(issues.map(issue => issue.code), ['REPEATED_QUOTE', 'QUOTES_BELOW_MINIMUM', 'LONG_QUOTE', 'SECTION_WITHOUT_QUOTE']);
  assert.deepEqual(issues.find(issue => issue.code === 'SECTION_WITHOUT_QUOTE')?.detail, 'Planos');
  assert.deepEqual(issues.find(issue => issue.code === 'QUOTES_BELOW_MINIMUM')?.detail, '2 of 3');
  assert.equal(metrics.quotes, 2);
  assert.equal(metrics.repeatedQuotes, 1);
  assert.equal(metrics.longQuotes, 1);
  assert.equal(metrics.longQuoteShare, 0.33);
  assert.equal(metrics.sections, 3);
  assert.equal(metrics.sectionsWithQuote, 2);
  assert.equal(metrics.quotableSections, 2);
  assert.equal(metrics.quotableSectionsWithQuote, 1);
  assert.equal(hardNewsLint(article('Nota', ['Um fato só.']), { minQuotes: 0 }).metrics.sections, 0, 'no headings, no sections');
});

test('metrics', () => {
  const { metrics } = hardNewsLint(STAND, STAND_OPTIONS);
  assert.equal(metrics.leadWords, 19);
  assert.equal(metrics.leadQuoted, false);
  assert.equal(metrics.leadRitual, false);
  assert.equal(metrics.leadSharesHeadline, true);
  assert.equal(metrics.leadNumber, true);
  assert.equal(metrics.headlineNumber, true);
  assert.deepEqual(metrics.headlineSoftVerbs, []);
  assert.equal(metrics.neutral, 7);
  assert.equal(metrics.evaluative, 0);
  assert.equal(metrics.quotes, 3);
  assert.equal(metrics.averageQuoteWords, 10);
  assert.equal(metrics.sectionsWithQuote, 2);
  assert.equal(metrics.quotableSectionsWithQuote, 2);
  assert.equal(metrics.selfClaimsUnattributed, 0);
  assert.equal(hardNewsLint(STAND, { minQuotes: 2 }).metrics.quotableSections, undefined);
  assert.equal(hardNewsLint(article('Nota sem título comum', ['O episódio do podcast tratou de exportação.']), { minQuotes: 0 }).metrics.leadSharesHeadline, false);
});
