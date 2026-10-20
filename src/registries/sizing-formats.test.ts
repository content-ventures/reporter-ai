import { test } from 'node:test';
import assert from 'node:assert/strict';
import { R1_ARTICLE_LIMITS } from '../domain/article-policy.ts';
import { draftSizeInstructions } from './sizing.ts';

test('a format sizes the draft by its range, its quotes and its intertítulos', () => {
  const note = draftSizeInstructions({ size: 'standard', sections: 1, format: 'note' });
  assert.equal(note.maxChars, 1500);
  assert.equal(note.headings, false);
  assert.equal(note.minQuotes, 0);
  assert.equal(note.minWords, undefined);
  const panel = draftSizeInstructions({ size: 'standard', sections: 3, format: 'panel', formatSize: 'full' });
  assert.equal(panel.sections.length, 3);
  assert.equal(panel.minQuotes, 3);
  assert.ok(panel.introChars + panel.sections.reduce((sum, section) => sum + section.budgetChars, 0) <= panel.targetChars);
  const article = draftSizeInstructions({ size: 'standard', sections: 3 });
  assert.equal(article.minQuotes, R1_ARTICLE_LIMITS.minQuotes);
});
