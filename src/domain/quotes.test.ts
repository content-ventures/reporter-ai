import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paragraphBlock, quoteBlock } from './article.ts';
import type { ArticleBody } from './article.ts';
import { checkQuotes, extractQuotes, quoteMatches } from './quotes.ts';
import { segmentRef } from './refs.ts';
import { reviseSource } from './source.ts';
import { createKit, sampleArticle, sampleSource } from './testing/scenario.ts';
import { foldForMatch } from './text/normalize.ts';

describe('quote extraction', () => {
  test('finds quote blocks and long inline quotations, ignoring quoted terms', () => {
    const body: ArticleBody = {
      type: 'article',
      title: '',
      blocks: [
        paragraphBlock('p1', 'Ela usa o termo "upcycling" e diz: “a feira mudou tudo para nós”.'),
        quoteBlock('q1', '  A feira mudou tudo.  '),
        quoteBlock('q2', '“Queremos abrir uma escola de ofício”, diz Marina.'),
      ],
    };
    const quotes = extractQuotes(body);
    assert.deepEqual(
      quotes.map((quote) => [quote.blockId, quote.kind, quote.text]),
      [
        ['p1', 'inline', 'a feira mudou tudo para nós'],
        ['q1', 'block', 'A feira mudou tudo.'],
        ['q2', 'block', 'Queremos abrir uma escola de ofício'],
      ],
    );
    const [inline] = quotes;
    assert.equal(body.blocks[0].type === 'paragraph' && body.blocks[0].inlines[0].text.slice(inline.range.from, inline.range.to), inline.text);
  });
});

describe('deterministic quote check', () => {
  test('passes when the quote is in the transcript (case, punctuation and quote marks ignored)', () => {
    const kit = createKit();
    const source = sampleSource(kit);
    const checks = checkQuotes(sampleArticle(source), [source]);
    assert.deepEqual(
      checks.map((check) => [check.blockId, check.status]),
      [
        ['b-p1', 'verified'],
        ['b-q1', 'verified'],
      ],
    );
    assert.deepEqual(checks[1].match, segmentRef(source.id, 1, 'seg-004'));
  });

  test('fails when a word was changed or invented', () => {
    const source = sampleSource(createKit());
    const body: ArticleBody = {
      type: 'article',
      title: '',
      blocks: [
        quoteBlock('q1', 'A feira mudou quase tudo.', { sourceRefs: [segmentRef(source.id, 1, 'seg-004')] }),
        quoteBlock('q2', 'Nunca pensamos em desistir.'),
      ],
    };
    assert.deepEqual(
      checkQuotes(body, [source]).map((check) => check.status),
      ['missing', 'missing'],
    );
  });

  test('accepts editorial elisions and insertions only when the fragments appear in order', () => {
    const haystack = foldForMatch('A feira mudou tudo. A gente saiu de lá com vinte lojistas novos e a certeza de que o couro reaproveitado tinha mercado.');
    assert.equal(quoteMatches('A feira mudou tudo (...) saiu de lá com vinte lojistas novos', haystack), true);
    assert.equal(quoteMatches('[A feira] mudou tudo… o couro reaproveitado tinha mercado', haystack), true);
    assert.equal(quoteMatches('o couro reaproveitado tinha mercado… A feira mudou tudo', haystack), false, 'order matters');
    assert.equal(quoteMatches('A feira mudou tu', haystack), false, 'partial words do not match');
    assert.equal(quoteMatches('…', haystack), false);
  });

  test('a quote spanning two segments of the same speaker is verified', () => {
    const kit = createKit();
    const base = sampleSource(kit);
    const split = reviseSource(
      base,
      [
        { type: 'update', segmentId: 'seg-004', text: 'A feira mudou tudo.' },
        { type: 'insert', afterSegmentId: 'seg-004', text: 'A gente saiu de lá com vinte lojistas novos.', speaker: 'Marina Lopes' },
      ],
      kit.ctx(),
    );
    assert.ok(split.ok);
    const body: ArticleBody = { type: 'article', title: '', blocks: [quoteBlock('q1', 'A feira mudou tudo. A gente saiu de lá com vinte lojistas novos.')] };
    assert.equal(checkQuotes(body, [split.value])[0].status, 'verified');
  });

  test('a quote is checked against the referenced source version', () => {
    const kit = createKit();
    const base = sampleSource(kit);
    const corrected = reviseSource(base, [{ type: 'update', segmentId: 'seg-004', text: 'A feira de 2016 mudou tudo.' }], kit.ctx());
    assert.ok(corrected.ok);
    const body: ArticleBody = {
      type: 'article',
      title: '',
      blocks: [quoteBlock('q1', 'A feira mudou tudo.', { sourceRefs: [segmentRef(base.id, 1, 'seg-004')] })],
    };
    assert.equal(checkQuotes(body, [corrected.value])[0].status, 'verified', 'the v1 segment still holds the quote');
    const unreferenced: ArticleBody = { type: 'article', title: '', blocks: [quoteBlock('q1', 'A feira mudou tudo.')] };
    assert.equal(checkQuotes(unreferenced, [corrected.value])[0].status, 'missing', 'the current version no longer says it');
  });
});
