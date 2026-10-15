import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { workerMediaStream,executableMountCandidates } from '../src/server/worker-media.ts';

test('runtime mount policy rejects noexec /run and /tmp even when both are writable',()=>{
  const mounts=['overlay / overlay ro 0 0','tmpfs /run tmpfs rw,noexec,nosuid 0 0','tmpfs /tmp tmpfs rw,noexec 0 0','tmpfs /dev tmpfs rw,nosuid 0 0','tmpfs /dev/shm tmpfs rw,noexec 0 0'].join('\n');
  assert.deepEqual(executableMountCandidates(mounts),['/dev']);
  assert.deepEqual(executableMountCandidates(mounts.replace('rw,nosuid','rw,nosuid,noexec')),[]);
});

test('worker media accepts the SDK Web-stream body used across runtime boundaries',async()=>{
  const stream=workerMediaStream({transformToWebStream:()=>new ReadableStream({start(controller){controller.enqueue(Buffer.from('verified-media'));controller.close();}})});
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(),'verified-media');
  assert.equal(workerMediaStream(Readable.from('node')).readable,true);
  assert.throws(()=>workerMediaStream(undefined),/MEDIA_TOOL_BODY_UNAVAILABLE/);
});
