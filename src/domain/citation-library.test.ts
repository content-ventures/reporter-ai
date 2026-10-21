import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranscriptSource, materialPartHashes } from './source.ts';
import type { Source } from './source.ts';
import { joinTranscriptParts, parseTranscript } from './text/transcript-parse.ts';
import { articlePlainText, articleStats } from './article.ts';
import type { ArticleBody } from './article.ts';
import { citationDay, citationUses, citationView, citationsFromArticle, emphasizeArticleQuotes, locateCitation, podcastLink } from './citation-library.ts';
const phrase = 'O controle de temperatura precisa acompanhar o pescado durante todo o transporte.';
const ctx = { now: '2026-10-13T12:00:00Z',actorId: 'editor',newId: () => 'source' };
function source(labeled = true) {
  return createTranscriptSource({ workspaceId: 'workspace',title: 'Episódio de teste sintético',origin: 'podcast',authorized: true,
    parsed: parseTranscript(labeled ? `Ana Costa: ${phrase}\nPedro Lima: Obrigado pela explicação.` : phrase,{ format: labeled ? 'speaker-lines' : 'plain' }),speakerPeople: { 'Ana Costa': 'ana' },
    programName: 'Programa fictício de teste',sourceUrl: 'https://example.com/episode',recordedOn: '2026-10-12',location: 'Estúdio fictício' },ctx);
}
function article(): ArticleBody {
  const s = source();return { type: 'article',title: 'Teste',blocks: [{ id: 'p',type: 'paragraph',inlines: [{ text: `Ela disse: “${phrase}” Esse é o contexto.` }],
    sourceRefs: [{ kind: 'source',sourceId: s.id,sourceVersion: 1,locator: { type: 'segment',segmentId: s.versions[0].content.segments[0].id } }] }] };
}
test('the citation registry retains literal words, transcript version and known attribution', () => {
  const s = source(),items = citationsFromArticle(article(),[s],'production',ctx.now);
  assert.equal(items.length,1);assert.equal(items[0].text,phrase);assert.equal(items[0].sourceHash,s.versions[0].hash);
  assert.equal(items[0].personId,'ana');assert.equal(items[0].podcastName,s.programName);
  const view = citationView(items[0],s,[{ id: 'ana',name: 'Ana Costa' }]);
  assert.equal(view.authorized,true);assert.equal(view.speaker,'Ana Costa');assert.equal(view.ready,false,'market relevance still needs editorial confirmation');
  assert.equal(citationView({ ...items[0],relevance: 'Relevância técnica confirmada.' },s,[{ id: 'ana',name: 'Ana Costa' }]).ready,true);
});
test('article entries say where they came from; a suggestion shows its linked speaker but is never ready', () => {
  const s = source(),[item] = citationsFromArticle(article(),[s],'production',ctx.now),people = [{ id: 'ana',name: 'Ana Costa' }];
  assert.equal(item.origin,'article');
  const suggestion = { ...item,origin: 'outline' as const,authorConfirmed: false,relevance: 'Relevância técnica confirmada.' };
  assert.equal(citationView(suggestion,s,people).speaker,'Ana Costa');
  assert.equal(citationView(suggestion,s,people).ready,false);
  assert.equal(citationView({ ...suggestion,origin: 'article' },s,people).speaker,'Autoria a confirmar','an unconfirmed article entry still waits for its author');
  assert.equal(citationView({ ...suggestion,authorConfirmed: true },s,people).ready,true);
});
test('introduced participants never identify an unlabeled voice; invented/changed quotes are rejected', () => {
  const s = source(false);s.speakers = [{ label: 'Ana Costa',personId: 'ana',presentation: { segmentId: s.versions[0].content.segments[0].id,excerpt: phrase } }];
  assert.equal(locateCitation(s,1,phrase)?.personId,undefined);
  assert.equal(locateCitation(s,1,phrase.replace('temperatura','preço')),undefined);
  assert.equal(locateCitation(s,2,phrase),undefined);
  assert.equal(citationsFromArticle(article(),[{ ...source(),rights: { authorized: false } }],'production',ctx.now).length,0);
});
test('quote emphasis does not change text, counts, evidence or existing inline marks', () => {
  const body = article(),emphasized = emphasizeArticleQuotes(body);
  assert.equal(articlePlainText(emphasized),articlePlainText(body));assert.deepEqual(articleStats(emphasized),articleStats(body));
  assert.deepEqual(emphasized.blocks[0].sourceRefs,body.blocks[0].sourceRefs);
  assert.ok(emphasized.blocks[0].type === 'paragraph' && emphasized.blocks[0].inlines.some(inline => inline.marks?.includes('bold')));
  assert.equal(body.blocks[0].type === 'paragraph' && body.blocks[0].inlines[0].marks,undefined,'input is untouched');
});
test('podcast links and dates reject unsafe or impossible metadata', () => {
  assert.equal(podcastLink('javascript:alert(1)'),undefined);assert.equal(podcastLink('https://user:secret@example.com'),undefined);
  assert.equal(podcastLink('https://example.com/episode'),'https://example.com/episode');
  assert.equal(citationDay('2026-02-30'),false);assert.equal(citationDay('2026-99-22'),false);assert.equal(citationDay('2026-10-12'),true);
});
test('a quotation the article opens with a capital is kept in the library as the source writes it', () => {
  const lower = 'o controle de temperatura precisa acompanhar o pescado durante todo o transporte.';
  const s = createTranscriptSource({ workspaceId: 'workspace',title: 'Episódio de teste sintético',origin: 'podcast',authorized: true,
    parsed: parseTranscript(`Ana Costa: Então ${lower}`,{ format: 'speaker-lines' }),speakerPeople: { 'Ana Costa': 'ana' } },ctx);
  const body: ArticleBody = { type: 'article',title: 'Teste',blocks: [{ id: 'p',type: 'paragraph',inlines: [{ text: `Ela disse: “O controle de temperatura precisa acompanhar o pescado durante todo o transporte.”` }],
    sourceRefs: [{ kind: 'source',sourceId: s.id,sourceVersion: 1,locator: { type: 'segment',segmentId: s.versions[0].content.segments[0].id } }] }] };
  const items = citationsFromArticle(body,[s],'production',ctx.now);
  assert.equal(items.length,1);assert.equal(items[0].text,lower);
  assert.equal(citationView(items[0],s,[{ id: 'ana',name: 'Ana Costa' }]).authorized,true);
});
test('citationView tells which part a quote is heard in', () => {
  const opening = '1\n00:00:00,000 --> 00:00:05,000\nPedro Lima: Vamos falar de logística refrigerada.\n';
  const cue = `1\n00:00:03,000 --> 00:00:08,000\nAna Costa: ${phrase}\n`;
  const text = joinTranscriptParts([{ text: opening, fileName: 'parte-1.srt' }, { text: cue, fileName: 'parte-2.srt' }]);
  const [first, second] = materialPartHashes(text) ?? [];
  const parts = createTranscriptSource({ workspaceId: 'workspace',title: 'Episódio em partes',origin: 'podcast',authorized: true,parsed: parseTranscript(text),
    parts: [{ fileName: 'parte-1.srt',hash: first },{ fileName: 'parte-2.srt',hash: second }],speakerPeople: { 'Ana Costa': 'ana' } },ctx);
  const view = (source: Source) => {
    const located = locateCitation(source,1,phrase);
    assert.ok(located);
    return citationView({ id: 'c',revision: 0,text: located.text,ref: located.ref,sourceHash: located.hash,productionId: 'production',
      createdAt: ctx.now,updatedAt: ctx.now,authorConfirmed: true,personId: 'ana',relevance: '' },source,[{ id: 'ana',name: 'Ana Costa' }]);
  };
  assert.deepEqual(view(parts).place,{ part: 2,count: 2,fileName: 'parte-2.srt',startMs: 3_000 });
  assert.equal(view(parts).startMs,5_000 + 3_000);
  const singleView = view(createTranscriptSource({ workspaceId: 'workspace',title: 'Episódio',origin: 'podcast',authorized: true,parsed: parseTranscript(cue),speakerPeople: { 'Ana Costa': 'ana' } },ctx));
  assert.equal('place' in singleView,false);
  assert.equal(singleView.startMs,3_000);
});
test('uses count one per production, keep the latest date and list the newest first', () => {
  const uses = citationUses([
    { citationId: 'a',productionId: 'p1',title: 'Primeira',at: '2026-10-01T10:00:00Z' },
    { citationId: 'a',productionId: 'p1',title: 'Primeira',at: '2026-10-03T10:00:00Z' },
    { citationId: 'a',productionId: 'p2',title: 'Segunda',at: '2026-10-02T10:00:00Z' },
    { citationId: 'b',productionId: 'p2',title: 'Segunda',at: '2026-10-02T10:00:00Z' },
  ]);
  assert.deepEqual(uses.get('a'),[{ productionId: 'p1',title: 'Primeira',at: '2026-10-03T10:00:00Z' },{ productionId: 'p2',title: 'Segunda',at: '2026-10-02T10:00:00Z' }]);
  assert.equal(uses.get('b')?.length,1);
});
