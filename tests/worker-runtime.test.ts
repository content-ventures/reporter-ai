import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mediaCommand } from '../src/server/worker-media.ts';

test('hosted tools run from the immutable package through the fixed ARM64 loader',()=>{
  const path=fileURLToPath(new URL('../src/server/bin/ffmpeg',import.meta.url));
  const args=['-i','/tmp/user material.mp4','-vn'];
  const command=mediaCommand(path,args,true);
  assert.equal(command.executable,'/lib/ld-linux-aarch64.so.1');
  assert.deepEqual(command.args,['--library-path',fileURLToPath(new URL('../src/server/bin/lib',import.meta.url)),path,...args]);
  assert.deepEqual(mediaCommand(path,args,false),{executable:path,args});
});

test('configured and arbitrary paths never acquire the hosted ELF launcher',()=>{
  for(const path of ['ffmpeg','/tmp/ffmpeg','/opt/custom/ffmpeg','/tmp/media; false']){
    const args=['-version'];assert.deepEqual(mediaCommand(path,args,true),{executable:path,args});
  }
});
