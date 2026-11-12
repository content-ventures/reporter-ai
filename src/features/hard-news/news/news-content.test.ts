import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBrief } from '../../../domain/production.ts';
import { NEWS_CONTENT_TYPES, newsContentBrief } from './news-content.ts';

test('every offered news content type produces a valid brief with its own structure', () => {
  for (const option of NEWS_CONTENT_TYPES) {
    const brief = newsContentBrief({ format: option.value }, '', 3);
    assert.equal(validateBrief({ ...brief, revision: 1 }).ok, true, option.value);
    assert.equal(brief.format, option.value === 'article' || option.value === 'carousel' ? undefined : option.value);
    assert.ok(brief.angle!.length <= 600);
  }
  const note = newsContentBrief({ format: 'note' }, '', 1);
  assert.equal(note.sections, 1);
  assert.match(note.angle!, /^Notícia/);
  assert.equal(newsContentBrief({ format: 'panel', formatSize: 'full' }, 'a'.repeat(250), 3).sections, 4);
});
