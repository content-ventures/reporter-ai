import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEditorialPolicy } from './editorial-policy.ts';
import { applyWritingGuideSuggestions, writingGuideSuggestions } from './writing-guide-suggestions.ts';

test('guide suggestions remain opt-in and preserve the outlet policy outside the previewed fields', () => {
  const guide = { ...defaultEditorialPolicy().guide, version: 8, voice: 'Voz particular', updatedBy: 'Editora',
    rules: [{ id: 'outlet', text: 'Regra própria.' }], terms: [{ avoid: 'players', use: 'empresas' }],
    examples: [{ id: 'example', title: 'Referência', url: 'https://example.com/article', note: 'Observação própria.' }],
    composition: { paragraphs: 'Parágrafos próprios', figures: 'Créditos obrigatórios', closing: 'Fechamento próprio' } };
  const original = structuredClone(guide);
  const changes = writingGuideSuggestions(guide);
  assert.equal(changes.length, 8);
  assert.equal(changes.find(change => change.id === 'voice')?.before, 'Voz particular');
  assert.deepEqual(guide, original);
  const next = applyWritingGuideSuggestions(guide);
  assert.deepEqual(guide, original);
  assert.equal(next.version, 8);
  assert.equal(next.updatedBy, 'Editora');
  for (const key of ['rules', 'terms', 'examples'] as const) assert.deepEqual(next[key], guide[key]);
  assert.equal(next.composition?.figures, guide.composition.figures);
  assert.equal(changes.find(change => change.id === 'closing')?.before, guide.composition.closing);
  assert.equal(next.composition?.closing, changes.find(change => change.id === 'closing')?.after);
  assert.deepEqual(writingGuideSuggestions(next), []);
});
