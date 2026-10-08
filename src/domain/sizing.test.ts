import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paragraphBlock } from './article.ts';
import { articleCharacters, articleStats } from './article.ts';
import { briefHash, DEFAULT_SECTIONS, validateBrief } from './production.ts';
import type { Brief } from './production.ts';
import {
  ARTICLE_SIZES,
  charactersAbove,
  CHARS_PER_LAUDA,
  DEFAULT_ARTICLE_SIZE,
  expectedDraftChars,
  formatCharacters,
  formatLaudas,
  formatLaudasOf,
  fitSections,
  laudaNumber,
  laudas,
  sectionBudget,
  shortenToSizeLabel,
  sizeFit,
  sizeLabel,
  sizeMeta,
  SIZE_RULE,
} from './sizing.ts';
import { countCharacters, textStats } from './text/stats.ts';

describe('article size by lauda (1 lauda = 2.000 characters)', () => {
  test('every range derives from the lauda: Curto 1.000–2.000 (target 1.800), Padrão 2.001–4.000 (target 3.600)', () => {
    assert.equal(CHARS_PER_LAUDA, 2000);
    assert.equal(DEFAULT_ARTICLE_SIZE, 'standard');
    assert.equal(DEFAULT_SECTIONS, 3);
    const { short, standard } = ARTICLE_SIZES;
    assert.deepEqual([short.label, short.laudas, short.minChars, short.maxChars, short.targetChars], ['Curto', 1, 1000, 2000, 1800]);
    assert.deepEqual([standard.label, standard.laudas, standard.minChars, standard.maxChars, standard.targetChars], ['Padrão', 2, 2001, 4000, 3600]);
    assert.deepEqual(short.sections, { min: 1, max: 3, default: 2 });
    assert.deepEqual(standard.sections, { min: 2, max: 5, default: 3 });
    assert.deepEqual([short.headings, standard.headings], [false, true], 'a Curto has no intertítulos');
    assert.equal(short.description, 'Notícia direta: um fato, pouco contexto. Até 2.000 caracteres.');
    assert.equal(standard.description, 'Notícia com contexto: histórico, citações, fontes e links. Até 4.000 caracteres.');
    assert.equal(SIZE_RULE, '1 lauda = 2.000 caracteres com espaços. A IA não completa o texto para chegar ao tamanho.');
    assert.deepEqual([sizeLabel('short'), sizeLabel('standard')], ['Curto · 1 lauda', 'Padrão · 2 laudas']);
    assert.deepEqual([shortenToSizeLabel('short'), shortenToSizeLabel('standard')], ['Encurtar para 1 lauda', 'Encurtar para 2 laudas']);
  });

  test('laudas round up to one decimal (a started line counts)', () => {
    assert.deepEqual([0, 1, 800, 2000, 2001, 2764, 4000, 4001].map(laudas), [0, 0.1, 0.4, 1, 1.1, 1.4, 2, 2.1]);
    assert.deepEqual([0.4, 1, 1.4, 2, 2.3].map(laudaNumber), ['0,4', '1', '1,4', '2', '2,3']);
    assert.equal(sizeMeta(2764, 'standard'), '1,4/2 laudas');
    assert.equal(sizeMeta(1600, 'short'), '0,8/1 lauda');
  });

  test('fit, sections and budgets', () => {
    assert.deepEqual([999, 1000, 2000, 2001].map((chars) => sizeFit('short', chars)), ['below', 'inside', 'inside', 'above']);
    assert.deepEqual([2000, 2001, 4000, 4001].map((chars) => sizeFit('standard', chars)), ['below', 'inside', 'inside', 'above']);
    assert.equal(fitSections('short', 5), 3);
    assert.equal(fitSections('standard', 1), 2);
    assert.equal(fitSections('standard', 4), 4);
    assert.deepEqual(sectionBudget('short', 2), { introChars: 720, sectionChars: 540 });
    assert.deepEqual(sectionBudget('standard', 3), { introChars: 900, sectionChars: 900 });
  });

  test('the expected draft: the target when the material reaches it, else all it gives, never above the maximum', () => {
    assert.deepEqual(expectedDraftChars('standard', 9000), { chars: 3600, reachesTarget: true, reachesRange: true });
    assert.deepEqual(expectedDraftChars('standard', 3240), { chars: 3600, reachesTarget: true, reachesRange: true }, 'within the tolerance');
    assert.deepEqual(expectedDraftChars('standard', 2900), { chars: 2900, reachesTarget: false, reachesRange: true });
    assert.deepEqual(expectedDraftChars('standard', 1500), { chars: 1500, reachesTarget: false, reachesRange: false });
    assert.deepEqual(expectedDraftChars('short', 1700), { chars: 1800, reachesTarget: true, reachesRange: true });
    assert.deepEqual(expectedDraftChars('short', 1500), { chars: 1500, reachesTarget: false, reachesRange: true });
    assert.deepEqual(expectedDraftChars('short', 600), { chars: 600, reachesTarget: false, reachesRange: false });
  });
});

describe('the lauda count', () => {
  test('characters with spaces, NFC, per code point, without line breaks', () => {
    assert.equal(countCharacters('Olá, mundo'), 10);
    assert.equal(countCharacters('Olá'), 3, 'a decomposed accent is one character');
    assert.equal(countCharacters('linha um\nlinha dois\r\n'), 18);
    assert.equal(textStats('R$ 18.000,00 hoje').characters, 17);
  });

  test('the body only: the blank lines between blocks never count', () => {
    const body = { type: 'article' as const, title: 'Título que não conta', blocks: [paragraphBlock('p1', 'Um.'), paragraphBlock('p2', 'Dois.')] };
    assert.equal(articleCharacters(body), 8);
    assert.equal(articleStats(body).characters, 8);
  });
});

describe('the brief (pauta) by size', () => {
  const brief = (patch: Partial<Brief> = {}): Brief => ({ sections: 3, size: 'standard', revision: 1, ...patch });

  test('sections are validated per size', () => {
    assert.equal(validateBrief(brief()).ok, true);
    assert.equal(validateBrief(brief({ size: 'short', sections: 1 })).ok, true);
    const curto = validateBrief(brief({ size: 'short', sections: 4 }));
    assert.equal(!curto.ok && curto.refusal.message, 'Curto aceita de 1 a 3 seções.');
    const padrao = validateBrief(brief({ sections: 1 }));
    assert.equal(!padrao.ok && padrao.refusal.code, 'sections_out_of_range');
    assert.equal(!padrao.ok && padrao.refusal.message, 'Padrão aceita de 2 a 5 seções.');
    const unknown = validateBrief(brief({ size: 'long' as never }));
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_size');
    assert.equal(!unknown.ok && unknown.refusal.message, 'Tamanho desconhecido.');
  });

  test('the size is part of the brief hash', () => {
    assert.notEqual(briefHash(brief()), briefHash(brief({ size: 'short' })));
    assert.equal(briefHash(brief()), briefHash(brief({ revision: 7 })), 'the revision is not content');
  });

  test('pt-BR lauda formats: alone, against the size, characters and the excess', () => {
    assert.deepEqual([800, 2000, 2764, 4000, 4600].map(formatLaudas), ['0,4 lauda', '1 lauda', '1,4 lauda', '2 laudas', '2,3 laudas']);
    assert.equal(formatLaudasOf(2764, 'standard'), '1,4 de 2 laudas');
    assert.equal(formatLaudasOf(1540, 'short'), '0,8 de 1 lauda');
    assert.equal(formatCharacters(2764), '2.764 caracteres');
    assert.equal(formatCharacters(1), '1 caractere');
    assert.equal(charactersAbove(4640, 'standard'), 640);
    assert.equal(charactersAbove(3999, 'standard'), 0);
    assert.equal(charactersAbove(2100, 'short'), 100);
  });
});
