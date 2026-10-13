import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { contentHash, fnv1a64, shortHash, stableStringify } from './hash.ts';
import { isSafeLink, normalizeLink } from './links.ts';
import { cleanText, foldForMatch, normalizeNewlines } from './normalize.ts';
import { countWords, readingMinutes, textStats, words } from './stats.ts';

describe('textStats', () => {
  test('counts pt-BR words with accents, apostrophes and hyphens as single words', () => {
    assert.deepEqual(words('Bem-vindo à caixa d’água, João!'), ['Bem-vindo', 'à', 'caixa', 'd’água', 'João']);
    assert.equal(countWords('  São 3 ateliês — e 20 lojistas.  '), 6);
    assert.equal(countWords(''), 0);
    assert.equal(countWords('— … !!'), 0);
  });

  test('reading time uses 200 wpm, rounds up, and is zero only for empty text', () => {
    assert.equal(readingMinutes(0), 0);
    assert.equal(readingMinutes(1), 1);
    assert.equal(readingMinutes(200), 1);
    assert.equal(readingMinutes(201), 2);
    assert.equal(readingMinutes(812), 5);
    assert.deepEqual(textStats('um dois três'), { words: 3, characters: 12, readingMinutes: 1 });
  });
});

describe('normalisation', () => {
  test('unifies newlines, removes BOM and exotic spaces', () => {
    assert.equal(normalizeNewlines('﻿a\r\nb\rc'), 'a\nb\nc');
    assert.equal(cleanText('  a  b​\n c  '), 'a b c');
  });

  test('foldForMatch ignores case, punctuation and quote styles but keeps diacritics', () => {
    assert.equal(foldForMatch('“A feira — mudou TUDO!”'), 'a feira mudou tudo');
    assert.equal(foldForMatch("d'água"), foldForMatch('d’água'));
    assert.notEqual(foldForMatch('é'), foldForMatch('e'));
  });
});

describe('content hash', () => {
  test('matches FNV-1a 64-bit reference vectors', () => {
    assert.equal(fnv1a64(''), 'cbf29ce484222325');
    assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c');
    assert.equal(fnv1a64('foobar'), '85944171f73967e8');
  });

  test('is independent of key order and drops undefined members', () => {
    assert.equal(stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] }), '{"a":[2,{"c":3}],"b":1}');
    assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
    assert.equal(contentHash({ a: 1, b: undefined }), contentHash({ a: 1 }));
    assert.notEqual(contentHash({ a: 1 }), contentHash({ a: 2 }));
  });

  test('hashes unicode text by UTF-8 bytes and shortens for display', () => {
    const hash = contentHash('ação');
    assert.match(hash, /^[0-9a-f]{16}$/);
    assert.notEqual(hash, contentHash('acao'));
    assert.equal(shortHash(hash), hash.slice(0, 7));
  });
});

describe('normalizeLink', () => {
  test('keeps http(s), mailto and tel; adds https to bare domains', () => {
    assert.deepEqual(normalizeLink('https://exemplo.com.br/a?b=1'), { ok: true, href: 'https://exemplo.com.br/a?b=1' });
    assert.deepEqual(normalizeLink('  exemplo.com.br/materia '), { ok: true, href: 'https://exemplo.com.br/materia' });
    assert.deepEqual(normalizeLink('www.ateliesul.com'), { ok: true, href: 'https://www.ateliesul.com/' });
    assert.deepEqual(normalizeLink('//cdn.exemplo.com/x'), { ok: true, href: 'https://cdn.exemplo.com/x' });
    assert.deepEqual(normalizeLink('marina@ateliesul.com'), { ok: true, href: 'mailto:marina@ateliesul.com' });
    assert.deepEqual(normalizeLink('tel:+55 51 3333-4444'), { ok: true, href: 'tel:+55513333-4444' });
    assert.deepEqual(normalizeLink('localhost:3000/x'), { ok: true, href: 'https://localhost:3000/x' });
  });

  test('refuses script-like and disguised schemes', () => {
    for (const input of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' java\tscript:alert(1)', '\u0000javascript:x', 'data:text/html,<b>x</b>', 'vbscript:x', 'file:///etc/passwd']) {
      assert.deepEqual(normalizeLink(input), { ok: false, reason: 'unsafe' }, input);
    }
    assert.deepEqual(normalizeLink('https://user:pass@exemplo.com'), { ok: false, reason: 'unsafe' });
  });

  test('refuses empty and malformed addresses', () => {
    assert.deepEqual(normalizeLink('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(normalizeLink('/relativo'), { ok: false, reason: 'invalid' });
    assert.deepEqual(normalizeLink('não é link'), { ok: false, reason: 'invalid' });
    assert.deepEqual(normalizeLink('https://semponto'), { ok: false, reason: 'invalid' });
    assert.deepEqual(normalizeLink('mailto:ninguem'), { ok: false, reason: 'invalid' });
    assert.equal(isSafeLink('exemplo.com'), true);
  });
});
