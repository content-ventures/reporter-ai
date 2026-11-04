import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inspectMedia, prepareChunk } from '../../src/server/media.ts';

test('QuickTime, M4V, Matroska and AVI recordings yield transcribable audio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-media-formats-'));
  try {
    for (const [extension, expected] of [
      ['mov', 'video/quicktime'], ['m4v', 'video/mp4'],
      ['mkv', 'video/webm'], ['avi', 'video/x-msvideo'],
    ] as const) {
      const source = join(directory, `recording.${extension}`);
      execFileSync('ffmpeg', [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-shortest', '-c:v', 'mpeg4', '-c:a', extension === 'avi' ? 'mp3' : 'aac', '-y', source,
      ]);
      const inspected = await inspectMedia(source);
      assert.equal(inspected.contentType, expected, extension);
      assert.ok(inspected.duration > 0 && inspected.duration <= 2, extension);
      const chunk = join(directory, `${extension}.flac`);
      await prepareChunk(source, chunk, 0, inspected.duration, AbortSignal.timeout(30_000));
      assert.equal((await inspectMedia(chunk)).contentType, 'audio/flac', extension);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
