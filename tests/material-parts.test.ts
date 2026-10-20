import assert from 'node:assert/strict';
import { test } from 'node:test';
import { materialPartsSchema, materialTranscriptIds } from '../src/server/material-parts.ts';

const FIRST = '00000000-0000-4000-8000-000000000001';
const SECOND = '00000000-0000-4000-8000-000000000002';
const parts = (count: number) => Array.from({ length: count }, (_, index) => ({ fileName: `parte-${index + 1}.srt` }));

test('the parts of a material are 2 to 10 strict recordings', () => {
  for (const count of [2, 10]) assert.equal(materialPartsSchema.safeParse(parts(count)).success, true, `${count} parts`);
  assert.equal(materialPartsSchema.safeParse([{ fileName: 'a.srt', transcriptId: FIRST }, { fileName: 'b.mp3', transcriptId: SECOND }]).success, true);
  for (const [label, value] of [
    ['1 part', parts(1)],
    ['11 parts', parts(11)],
    ['an extra key', [{ fileName: 'a.srt', size: 10 }, { fileName: 'b.srt' }]],
    ['a bad uuid', [{ fileName: 'a.srt', transcriptId: 'transcript-1' }, { fileName: 'b.srt' }]],
    ['a blank name', [{ fileName: '  ' }, { fileName: 'b.srt' }]],
  ] as const) assert.equal(materialPartsSchema.safeParse(value).success, false, label);
});

test('materialTranscriptIds lists each transcript once and refuses ids that do not match the parts', () => {
  assert.deepEqual(materialTranscriptIds({}), []);
  assert.deepEqual(materialTranscriptIds({ transcriptId: FIRST }), [FIRST]);
  assert.deepEqual(materialTranscriptIds({ transcriptId: FIRST, parts: [{ transcriptId: FIRST }, { transcriptId: SECOND }] }), [FIRST, SECOND]);
  assert.deepEqual(materialTranscriptIds({ parts: [{}, {}] }), []);
  const invalid = (error: { code?: string; status?: number }) => error.code === 'MATERIAL_PARTS_INVALID' && error.status === 422;
  assert.throws(() => materialTranscriptIds({ transcriptId: SECOND, parts: [{ transcriptId: FIRST }, {}] }), invalid, 'a foreign top-level id');
  assert.throws(() => materialTranscriptIds({ transcriptId: FIRST, parts: [{ transcriptId: FIRST }, { transcriptId: FIRST }] }), invalid, 'a repeated part id');
});
