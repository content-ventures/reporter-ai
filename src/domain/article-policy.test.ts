import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contiguousSourcePassages, articleLengthIssue, articleQuotationIssue, literalQuoteText, quoteInSource, R1_ARTICLE_LIMITS, r1ArticleIssue, unquoteUnsupported } from './article-policy.ts';
import { articleStats, headingBlock, listBlock, paragraphBlock } from './article.ts';
import { createKit, sampleSource } from './testing/scenario.ts';

test('R1 boundaries are inclusive and character and word limits apply simultaneously', () => {
  const issue = (characters: number, words: number) => articleLengthIssue({ characters, words }, R1_ARTICLE_LIMITS);
  assert.equal(issue(2499, 500), 'ARTICLE_SIZE_TOO_SHORT');
  assert.equal(issue(2500, 500), undefined);
  assert.equal(issue(4000, 800), undefined);
  assert.equal(issue(4001, 700), 'ARTICLE_SIZE_EXCEEDED');
  assert.equal(issue(3500, 499), 'ARTICLE_WORDS_TOO_FEW');
  assert.equal(issue(3500, 801), 'ARTICLE_WORDS_EXCEEDED');
});

test('mandatory quotations are distinct, substantive, literal and tied to the SAME paragraph evidence', () => {
  const a = 'A fonte confirma o fato.';
  const b = 'O episódio apresenta mais dados.';
  const evidence = new Map([['a', a], ['b', b]]);
  const quote = (text: string, evidenceIds = ['a']) => ({ text: `A fonte diz: “${text}”`, evidenceIds });
  assert.equal(articleQuotationIssue([quote(a), quote(b, ['b'])], evidence, 2), undefined);
  assert.equal(articleQuotationIssue([quote(a), quote(a)], evidence, 2), 'ARTICLE_QUOTES_REQUIRED');
  assert.equal(articleQuotationIssue([quote(a.replace('confirma', 'nega'))], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote(a, ['b'])], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote(a, ['missing'])], evidence), 'UNKNOWN_EVIDENCE');
  assert.equal(articleQuotationIssue([{ text: '“Uma fala sem fechar.', evidenceIds: ['a'] }], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote('A fonte'), quote('O episódio', ['b'])], evidence, 2), 'ARTICLE_QUOTES_REQUIRED');
  assert.equal(articleQuotationIssue([quote('A fonte (...) o fato.')], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(literalQuoteText('Ola\u0301\n mundo'), 'Olá mundo');
  assert.equal(articleQuotationIssue([quote('A fonte CONFIRMA o fato.')], evidence), 'UNSUPPORTED_ARTICLE_QUOTE', 'case and words are not silently rewritten');
  // Measured on staging: the model ends a quotation with a comma to continue its own sentence.
  assert.equal(articleQuotationIssue([quote('A fonte confirma o fato,')], evidence), undefined, 'only the closing punctuation may adapt');
  assert.equal(articleQuotationIssue([quote('A fonte confirma o fato,'), quote(a)], evidence, 2), 'ARTICLE_QUOTES_REQUIRED', 'the same words are one quotation');
  assert.equal(articleQuotationIssue([quote('A fonte nega o fato,')], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  // A question or an exclamation changes the meaning; a cut word or number is not the source's.
  const asked = new Map([['q', 'Quem vai pagar a conta? Custa R$ 1.200.000 ao ano.']]);
  assert.equal(articleQuotationIssue([{ text: 'Ele disse: “Quem vai pagar a conta!”', evidenceIds: ['q'] }], asked), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([{ text: 'Ele disse: “Quem vai pagar a conta?”', evidenceIds: ['q'] }], asked), undefined);
  assert.equal(articleQuotationIssue([{ text: 'Ele disse: “Custa R$ 1.200.”', evidenceIds: ['q'] }], asked), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([{ text: 'Ele disse: “Custa R$ 1.200.000 ao ano,”', evidenceIds: ['q'] }], asked), undefined);
  assert.equal(articleQuotationIssue([{ text: 'Ele disse: “uem vai pagar a conta?”', evidenceIds: ['q'] }], asked), 'UNSUPPORTED_ARTICLE_QUOTE');
});

test('edited drafts cannot bypass R1 by inflating the title or removing quote provenance', () => {
  const source = sampleSource(createKit());
  const sentences = source.versions[0].content.segments.slice(0, 2);
  const body = { type: 'article' as const, title: 'Título '.repeat(100), blocks: [paragraphBlock('p', 'Breve.')] };
  assert.equal(articleStats(body).characters, 6);
  assert.equal(r1ArticleIssue(body, [source]), 'ARTICLE_SIZE_TOO_SHORT');
  const filler = Array(510).fill('fato').join(' ') + '.';
  const supported = { type: 'article' as const, title: 'Não conta', blocks: [paragraphBlock('p', filler), ...sentences.map((segment, i) =>
    paragraphBlock('q' + i, `No episódio: “${segment.text}”`, { sourceRefs: [{ kind: 'source' as const, sourceId: source.id,
      sourceVersion: 1, locator: { type: 'segment' as const, segmentId: segment.id } }] }))] };
  assert.equal(r1ArticleIssue(supported, [source]), undefined);
  for (const extra of [headingBlock('bad-heading', '“Uma fala que não está na fonte.”', 2), listBlock('bad-list', ['“Uma fala que não está na fonte.”'])]) {
    assert.equal(r1ArticleIssue({ ...supported, blocks: [...supported.blocks, extra] }, [source]), 'UNSUPPORTED_ARTICLE_QUOTE', 'headings and lists cannot hide invented quotations');
  }
  assert.equal(r1ArticleIssue({ ...supported, blocks: supported.blocks.map(block => ({ ...block, sourceRefs: [] })) }, [source]), 'UNSUPPORTED_ARTICLE_QUOTE');
});

test('a literal quotation may cross adjacent cited sentences in one source segment, never a gap',()=>{
  const source=sampleSource(createKit()),first='A primeira fala confirma o fato.',second='A segunda registra outros detalhes.',third='A terceira encerra a explicação.';
  const segment=source.versions[0].content.segments[0];segment.text=[first,second,third].join(' ');
  const reference=(from:number,to:number)=>({kind:'source' as const,sourceId:source.id,sourceVersion:1,locator:{type:'segment' as const,segmentId:segment.id,from,to}});
  const refs=[reference(0,first.length),reference(first.length+1,first.length+1+second.length),reference(first.length+second.length+2,segment.text.length)];
  const evidence=new Map(refs.map((ref,i)=>[String(i),segment.text.slice(ref.locator.from,ref.locator.to)]));
  const passages=(ids:readonly string[])=>contiguousSourcePassages([source],ids.map(id=>refs[Number(id)]));
  const quote={text:`“${first} ${second}”`,evidenceIds:['0','1']};
  assert.equal(articleQuotationIssue([quote],evidence,0,passages),undefined);
  assert.equal(articleQuotationIssue([{...quote,evidenceIds:['0']}],evidence,0,passages),'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([{text:`“${first} ${third}”`,evidenceIds:['0','2']}],evidence,0,passages),'UNSUPPORTED_ARTICLE_QUOTE');
  const foreign={...source,id:'another-source'};
  assert.deepEqual(contiguousSourcePassages([source,foreign],[refs[0],{...refs[1],sourceId:foreign.id}]).sort(),[first,second].sort(),'different sources cannot be spliced into one quote');
  const filler=Array(510).fill('fato').join(' ')+'.';
  const body={type:'article' as const,title:'Título',blocks:[paragraphBlock('body',filler),paragraphBlock('q1',quote.text,{sourceRefs:refs.slice(0,2)}),paragraphBlock('q2',`“${third}”`,{sourceRefs:[refs[2]]})]};
  assert.equal(r1ArticleIssue(body,[source]),undefined,'the final persisted article uses the same literal range validation');
});

test('a literal quotation may only capitalize its first letter', () => {
  const evidence = new Map([['e1', 'a gente reconhece que é um evento que tem uma conotação nacional']]);
  const quoted = (text: string) => [{ text, evidenceIds: ['e1'] }];
  assert.equal(articleQuotationIssue(quoted('“A gente reconhece que é um evento que tem uma conotação nacional”, afirmou.'), evidence), undefined);
  assert.equal(articleQuotationIssue(quoted('“A Gente reconhece que é um evento”, afirmou.'), evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(quoteInSource('a gente reconhece o evento', 'A gente reconhece'), 'a gente reconhece');
  assert.equal(quoteInSource('o agente reconhece', 'Gente reconhece'), undefined, 'a cut word never becomes a quotation');
  assert.equal(unquoteUnsupported(quoted('“A gente reconhece que é um evento”, afirmou.'), evidence)[0].text, '“A gente reconhece que é um evento”, afirmou.');
});
