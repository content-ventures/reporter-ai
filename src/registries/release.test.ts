import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CURRENT_RELEASE, releaseIndex, RELEASES } from './release.ts';
import type { ReleaseId } from './release.ts';

type History = { currentRoadmapRelease: ReleaseId; upcoming?: { roadmapRelease: ReleaseId; title: string } };

const history = JSON.parse(readFileSync(new URL('../data/release-history.json', import.meta.url), 'utf8')) as History;

describe('build release vs Novidades (D05, P14)', () => {
  it('CURRENT_RELEASE is the released roadmap release or the next one', () => {
    const released = releaseIndex(history.currentRoadmapRelease);
    const shown = releaseIndex(CURRENT_RELEASE);
    assert.ok(released >= 0 && shown >= 0, `${history.currentRoadmapRelease} and ${CURRENT_RELEASE} are roadmap releases`);
    assert.ok(shown === released || shown === released + 1, `the build shows ${CURRENT_RELEASE}; the history is at ${history.currentRoadmapRelease}`);
  });

  it('a build ahead of the history announces its release in "Em preparação"', () => {
    if (CURRENT_RELEASE === history.currentRoadmapRelease) return;
    assert.equal(history.upcoming?.roadmapRelease, CURRENT_RELEASE);
    assert.ok(history.upcoming?.title.trim());
    assert.ok(RELEASES.includes(history.upcoming.roadmapRelease));
  });
});
