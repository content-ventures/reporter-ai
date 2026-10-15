import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { workerMediaStream } from '../src/server/worker-media.ts';

test('worker media accepts the SDK Web-stream body used across runtime boundaries',async()=>{
  const stream=workerMediaStream({transformToWebStream:()=>new ReadableStream({start(controller){controller.enqueue(Buffer.from('verified-media'));controller.close();}})});
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(),'verified-media');
  assert.equal(workerMediaStream(Readable.from('node')).readable,true);
  assert.throws(()=>workerMediaStream(undefined),/MEDIA_TOOL_BODY_UNAVAILABLE/);
});
