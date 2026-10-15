import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeMediaAssets } from './native-media-assets.mjs';

test('the deploy rejects missing, wrong-architecture and wrong-version native packages',async()=>{
  const root=await mkdtemp(join(tmpdir(),'reporter-native-assets-'));
  const files=['ffmpeg','ffprobe','lib/libavcodec.so.63','lib/libavformat.so.63','lib/libavutil.so.61','lib/libavfilter.so.12','lib/libswresample.so.7'];
  const elf=Buffer.alloc(64);elf.write('\x7fELF');elf[4]=2;elf[5]=1;elf.writeUInt16LE(183,18);
  try{
    await mkdir(join(root,'bin/lib'),{recursive:true});
    await assert.rejects(nativeMediaAssets(root),/asset missing/);
    for(const name of files)await writeFile(join(root,'bin',name),elf);
    await writeFile(join(root,'FFmpeg-LICENSE.txt'),'LGPL test fixture');
    await writeFile(join(root,'FFmpeg-VERSION.txt'),'9.0.2\n');
    assert.equal(Object.keys(await nativeMediaAssets(root)).length,9);
    const foreign=Buffer.from(elf);foreign.writeUInt16LE(62,18);
    await writeFile(join(root,'bin/ffmpeg'),foreign);
    await assert.rejects(nativeMediaAssets(root),/ARM64 ELF/);
    await writeFile(join(root,'bin/ffmpeg'),elf);
    await writeFile(join(root,'FFmpeg-VERSION.txt'),'0.0.0');
    await assert.rejects(nativeMediaAssets(root),/Unexpected FFmpeg/);
  }finally{await rm(root,{recursive:true,force:true});}
});
