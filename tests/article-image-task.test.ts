import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseRecord, commitVersion, createKit, recordDecision, sampleArticle } from '../src/domain/testing/scenario.ts';
import { articleImageTarget, articleImageTargetMatches } from '../src/server/article-image-task.ts';
import { toVersionRef } from '../src/domain/piece.ts';

test('background image targets include body, revision, version, review flags and manual image choices', () => {
  const kit = createKit(),record = baseRecord(kit);
  const version = commitVersion(record,kit,'article',sampleArticle(record.sources[0]),{ origin: 'generation' });
  const piece = record.pieces.find(piece => piece.id === version.pieceId)!;
  const target = articleImageTarget(record,piece.id)!;
  assert.equal(articleImageTargetMatches(record,piece.id,target),true);
  record.reviewRequests.push({ id: 'pending',gate: 'article.approval',subject: toVersionRef(version),requestedAt: kit.now(),requestedBy: version.createdBy });
  assert.equal(articleImageTargetMatches(record,piece.id,target),false,'reviewed snapshots cannot change in the background');
  record.reviewRequests = [];
  for (const change of [
    () => { piece.draft.revision++; },
    () => { piece.draft.basedOn = 'restored-version'; },
    () => { if (piece.draft.body.type === 'article') piece.draft.body.title += ' edit'; },
    () => { if (piece.draft.body.type === 'article') piece.draft.body.blocks[0].ai = 'reviewed'; },
    () => { if (piece.draft.body.type === 'article') piece.draft.body.cover = { assetId: 'manual',alt: 'My image' }; },
  ]) {
    const before = structuredClone(piece.draft); change();
    assert.equal(articleImageTargetMatches(record,piece.id,target),false);
    piece.draft = before;
  }
  recordDecision(record,kit,version,'approved');
  assert.equal(articleImageTargetMatches(record,piece.id,target),false,'an approval prevents any background replacement');
});
