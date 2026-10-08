import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArticleBody, SourceVersion } from '../../domain/index.ts';
import type { Participant } from '../../ports/index.ts';
import { citedSegmentIds, viewerSegments } from './material-model.ts';

const VERSION: SourceVersion = {
  number: 1,
  hash: 'h1',
  createdAt: '2026-10-01T09:00:00.000Z',
  createdBy: 'person-joao',
  content: {
    type: 'transcript',
    format: 'speaker-lines',
    segments: [
      { id: 'seg-1', speaker: 'Entrevistadora', text: 'Como começou?', startMs: 0 },
      { id: 'seg-2', speaker: 'R.', text: 'Com uma reclamação.', startMs: 4_000, endMs: 9_000 },
      { id: 'seg-3', text: 'Nota sem falante.' },
    ],
  },
} as SourceVersion;

const PARTICIPANTS: Participant[] = [
  { label: 'Entrevistadora', segments: 1, words: 2, person: { id: 'person-clara', name: 'Clara Souto', initials: 'CS', avatarUrl: '/clara.png' } },
  { label: 'R.', segments: 1, words: 3 },
];

describe('material model', () => {
  it('draws each speaker as the person it is mapped to, keeping the label as the id', () => {
    const segments = viewerSegments(VERSION, PARTICIPANTS);
    assert.deepEqual(segments[0]?.speaker, { id: 'Entrevistadora', name: 'Clara Souto', src: '/clara.png' });
    assert.deepEqual(segments[1]?.speaker, { id: 'R.', name: 'R.' });
    assert.equal(segments[1]?.start, 4_000);
    assert.equal(segments[1]?.end, 9_000);
    assert.equal(segments[2]?.speaker, undefined);
    assert.equal(segments[2]?.start, undefined);
  });

  it('marks the segments of this source that the article cites', () => {
    const ref = (sourceId: string, segmentId: string) => ({ kind: 'source' as const, sourceId, sourceVersion: 1, locator: { type: 'segment' as const, segmentId } });
    const body = {
      type: 'article',
      title: 'Título',
      blocks: [
        { id: 'b1', type: 'paragraph', inlines: [{ text: 'a' }], sourceRefs: [ref('src-1', 'seg-2'), ref('src-2', 'seg-9')] },
        { id: 'b2', type: 'quote', inlines: [{ text: 'b' }], sourceRefs: [ref('src-1', 'seg-2'), ref('src-1', 'seg-1')] },
        { id: 'b3', type: 'divider' },
      ],
    } as unknown as ArticleBody;
    assert.deepEqual(citedSegmentIds(body, 'src-1'), ['seg-2', 'seg-1']);
    assert.deepEqual(citedSegmentIds(undefined, 'src-1'), []);
  });
});
