import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redo, undo } from '@tiptap/pm/history';
import { blockText, paragraphBlock, quoteBlock, type ArticleBody } from '../domain/article.ts';
import { memoryArticleContentIssues } from '../domain/editorial-memory-article.ts';
import { memoryWritingProvenance } from '../domain/editorial-memory-writing.ts';
import { checkQuotes, extractQuotes } from '../domain/quotes.ts';
import { segmentRef } from '../domain/refs.ts';
import { createTranscriptSource, sourceContentHash, type Source } from '../domain/source.ts';
import { parseTranscript } from '../domain/text/transcript-parse.ts';
import { memoryWritingFixture } from '../domain/testing/editorial-memory.ts';
import { articleState, testView } from './test-support.ts';
import { docBody } from './nodes.ts';
import { recoverSourceQuote } from './source-quotes.ts';

let n = 0;
const ctx = { now: '2026-10-29T03:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
const literal = 'Queremos  ouvir\n todas as pessoas neste exemplo sintético.';
function fixture(text = literal) {
  const bank = memoryWritingFixture('citation', text, ctx), source = bank.source, version = source.versions[0], segment = version.content.segments[0];
  const ref = segmentRef(source.id, 1, segment.id, { from: 0, to: text.length });
  const body: ArticleBody = { type: 'article', title: '', blocks: [quoteBlock('q', text.replace('ouvir', 'escutar'), { sourceRefs: [ref], ai: 'reviewed' })] };
  return { ...bank, ref, body, view: testView(articleState(body, { history: true })), quote: extractQuotes(body)[0] };
}
test('quote recovery changes literal words and exact bank receipts in one undoable step', () => {
  const f = fixture(), snapshot = structuredClone(f.source), expected = { ...f.body, blocks: [quoteBlock('q', literal, { sourceRefs: [f.ref], ai: 'reviewed' })] };
  assert.equal(checkQuotes(f.body, [f.source])[0].status, 'missing');
  assert.equal(recoverSourceQuote(f.view, f.quote, { text: literal, ref: f.ref }, [f.source]), true);
  const after = docBody(f.view.state.doc, { keepEmpty: true });
  assert.deepEqual(after, expected); assert.deepEqual(f.source, snapshot);
  assert.deepEqual(memoryArticleContentIssues(after, [f.source]), []);
  assert.deepEqual(memoryWritingProvenance(after, [f.source])[0].selected, f.selection.items[0]);
  assert.equal(checkQuotes(after, [f.source])[0].status, 'verified');
  assert.ok(undo(f.view.state, f.view.dispatch)); assert.deepEqual(docBody(f.view.state.doc, { keepEmpty: true }), f.body);
  assert.ok(redo(f.view.state, f.view.dispatch)); assert.deepEqual(docBody(f.view.state.doc, { keepEmpty: true }), expected);
});
test('repairing one inline quote preserves formatting and the other literal quote from the same bank item', () => {
  const text = literal + ' Outra observação literal neste material sintético.', f = fixture(text), second = text.slice(literal.length + 1);
  const bad = literal.replace('ouvir', 'escutar'), prefix = 'Segundo a fonte: “', suffix = `” e depois “${second}”.`;
  const body: ArticleBody = { type: 'article', title: '', blocks: [paragraphBlock('p', [{ text: prefix, marks: ['bold'] }, { text: bad }, { text: suffix, marks: ['italic'] }], { sourceRefs: [f.ref] })] };
  const view = testView(articleState(body, { history: true })), quote = extractQuotes(body)[0];
  const firstRef = segmentRef(f.source.id, 1, f.ref.locator.type === 'segment' ? f.ref.locator.segmentId : '', { from: 0, to: literal.length });
  assert.ok(recoverSourceQuote(view, quote, { text: literal, ref: firstRef }, [f.source]));
  const after = docBody(view.state.doc, { keepEmpty: true }), block = after.blocks[0]; assert.equal(block.type, 'paragraph');
  assert.equal(blockText(block), prefix + literal + suffix);
  assert.deepEqual(block.inlines[0].marks, ['bold']); assert.deepEqual(block.inlines.at(-1)!.marks, ['italic']);
  assert.deepEqual(block.sourceRefs?.map(ref => ref.locator), [firstRef.locator,
    { type: 'segment', segmentId: f.source.memory![0].items[0].segmentId, from: literal.length + 1, to: text.length }]);
  assert.deepEqual(memoryArticleContentIssues(after, [f.source]), []);
});
test('changed words or source references make an open repair stale without modifying the document', () => {
  for (const change of ['words', 'references']) {
    const f = fixture();
    const changed = structuredClone(f.body);
    if (change === 'words' && changed.blocks[0].type === 'quote') changed.blocks[0].inlines[0].text += ' Human edit.';
    else changed.blocks[0].sourceRefs = [];
    const view = testView(articleState(changed));
    const before = docBody(view.state.doc, { keepEmpty: true });
    assert.equal(recoverSourceQuote(view, f.quote, { text: literal, ref: f.ref }, [f.source]), false);
    assert.equal(view.dispatched.length, 0); assert.deepEqual(docBody(view.state.doc, { keepEmpty: true }), before);
  }
});
test('wrong versions, changed hashes, unavailable rights and nonliteral excerpts never repair a quote', () => {
  const f = fixture();
  for (const mutate of [(copy: Source) => { copy.rights.authorized = false; }, (copy: Source) => { copy.versions[0].hash = 'changed'; },
    (copy: Source) => { copy.memory![0].items = []; }]) {
    const copy = structuredClone(f.source); mutate(copy);
    assert.equal(recoverSourceQuote(f.view, f.quote, { text: literal, ref: f.ref }, [copy]), false);
  }
  assert.equal(recoverSourceQuote(f.view, f.quote, { text: literal, ref: { ...f.ref, sourceVersion: 99 } }, [f.source]), false);
  assert.equal(recoverSourceQuote(f.view, f.quote, { text: literal.replace(/\s+/g, ' '), ref: f.ref }, [f.source]), false);
  assert.equal(f.view.dispatched.length, 0);
});
test('historical bank receipts remain readable but cannot write a recovered quotation', () => {
  const f = fixture(), source = structuredClone(f.source), content = { type: 'transcript' as const, format: 'plain' as const, segments: [] };
  const hash = sourceContentHash(content);
  source.versions.push({ ...source.versions[0], number: 2, content, hash });
  source.memory!.push({ ...source.memory![0], version: { number: 2, hash }, items: [], retired: true });
  assert.equal(recoverSourceQuote(f.view, f.quote, { text: literal, ref: f.ref }, [source]), false);
  assert.equal(f.view.dispatched.length, 0);
});
test('unreferenced missing quotations can adopt an authorized bank origin; statistics cannot become speech', () => {
  const f = fixture(), body: ArticleBody = { ...f.body, blocks: [quoteBlock('q', f.quote.text)] }, view = testView(articleState(body));
  assert.ok(recoverSourceQuote(view, extractQuotes(body)[0], { text: literal, ref: f.ref }, [f.source]));
  assert.deepEqual(docBody(view.state.doc).blocks[0].sourceRefs, [f.ref]);
  const stat = memoryWritingFixture('statistic', 'Foram atendidas cerca de 240 pessoas em 2025.', ctx), segment = stat.source.versions[0].content.segments[0];
  assert.equal(recoverSourceQuote(testView(articleState(body)), extractQuotes(body)[0], { text: segment.text,
    ref: segmentRef(stat.source.id, 1, segment.id) }, [stat.source]), false);
});
test('ordinary transcript recovery preserves its own immutable historical source and a precise fragment range', () => {
  const text = 'Errar no protótipo ficou barato.', source = createTranscriptSource({ workspaceId: 'workspace', title: 'Entrevista sintética',
    origin: 'interview', parsed: parseTranscript('Pessoa: ' + text), authorized: true }, ctx), segment = source.versions[0].content.segments[0];
  const ref = segmentRef(source.id, 1, segment.id), literal = text.slice(0, -1);
  const body: ArticleBody = { type: 'article', title: '', blocks: [quoteBlock('q', 'Errar no protótipo parece barato', { sourceRefs: [ref] })] };
  const content = { ...source.versions[0].content, segments: [{ ...segment, text: 'A versão atual contém outras palavras.' }] };
  source.versions.push({ ...source.versions[0], number: 2, content, hash: sourceContentHash(content) });
  const from = segment.text.indexOf(text);
  const view = testView(articleState(body)), exact = segmentRef(source.id, 1, segment.id, { from, to: from + literal.length });
  assert.ok(recoverSourceQuote(view, extractQuotes(body)[0], { text: literal, ref: exact }, [source]));
  assert.deepEqual(docBody(view.state.doc).blocks[0].sourceRefs, [exact]);
  assert.equal(checkQuotes(docBody(view.state.doc), [source])[0].status, 'verified');
});
