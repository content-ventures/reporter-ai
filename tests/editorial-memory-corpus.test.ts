import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';

const kinds = z.enum(['fact', 'declared', 'opinion', 'forecast']);
const corpusSchema = z.object({
  schemaVersion: z.literal(1), synthetic: z.literal(true), split: z.literal('development'), editorialAcceptance: z.literal(false),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]+$/), title: z.string().startsWith('Synthetic '),
    format: z.enum(['plain', 'speaker-lines']), text: z.string().min(24),
    publishedOn: z.iso.date().nullable(),
    quotes: z.array(z.object({ text: z.string().min(24), speaker: z.string().nullable(),
      kinds: z.array(kinds).min(1), search: z.boolean() }).strict()),
    statistics: z.array(z.object({ evidence: z.string().min(1), valueText: z.string().min(1), unit: z.string().min(1),
      period: z.string().nullable(), kind: kinds, qualifier: z.string().nullable() }).strict()),
    tags: z.array(z.string().min(1)).min(1),
  }).strict()).min(20),
}).strict();

const corpus = corpusSchema.parse(JSON.parse(readFileSync(new URL('./fixtures/editorial-memory.json', import.meta.url), 'utf8')));

test('the development corpus is explicitly synthetic, never an accepted editorial benchmark', () => {
  assert.equal(corpus.synthetic, true);
  assert.equal(corpus.editorialAcceptance, false);
  assert.equal(corpus.split, 'development');
  assert.equal(new Set(corpus.cases.map(item => item.id)).size, corpus.cases.length);
});

test('every expected quote and numeric observation is grounded in its own original synthetic source', async t => {
  for (const item of corpus.cases) await t.test(item.id, () => {
    for (const quote of item.quotes) {
      assert.ok(item.text.includes(quote.text), 'quote wording must be literal');
      assert.equal(quote.search, quote.kinds.some(kind => kind === 'fact' || kind === 'declared'));
      if (quote.speaker !== null) {
        assert.equal(item.format, 'speaker-lines');
        assert.ok(item.text.includes(`${quote.speaker}: ${quote.text}`), 'a name mentioned in source prose is not a speaker label');
      }
    }
    for (const statistic of item.statistics) {
      assert.ok(item.text.includes(statistic.evidence), 'statistic evidence must be literal');
      assert.ok(statistic.evidence.includes(statistic.valueText), 'raw value and scale must be in the evidence');
      assert.ok(statistic.evidence.includes(statistic.unit), 'unit must be in the evidence');
      if (statistic.qualifier !== null) assert.ok(statistic.evidence.includes(statistic.qualifier));
      for (const year of statistic.period?.match(/\b\d{4}\b/g) ?? []) assert.ok(statistic.evidence.includes(year));
    }
  });
});

test('the corpus contains negative controls and distinct numeric and temporal failure modes', () => {
  const tags = new Set(corpus.cases.flatMap(item => item.tags));
  for (const tag of ['unknown-author', 'no-inferred-attribution', 'mixed-claims', 'numeric-locale', 'range', 'forecast',
    'approximation', 'negative-value', 'percentage-points', 'currency', 'zero', 'unknown-period', 'different-period-not-conflict',
    'conflict-needs-review', 'different-geography-not-conflict', 'historical', 'source-instructions', 'institution-versus-person', 'empty-extraction']) {
    assert.ok(tags.has(tag), `missing evaluation category: ${tag}`);
  }
  assert.ok(corpus.cases.some(item => !item.quotes.length && !item.statistics.length));
  assert.ok(corpus.cases.some(item => item.publishedOn && item.statistics.some(statistic => statistic.period === null)));
  assert.ok(corpus.cases.some(item => item.quotes.some(quote => quote.speaker === null)));
});
