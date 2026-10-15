import { readdir,readFile } from 'node:fs/promises';
import { join } from 'node:path';

const required=['bin/ffmpeg','bin/ffprobe','bin/lib/libavcodec.so.63','bin/lib/libavformat.so.63','bin/lib/libavutil.so.61','bin/lib/libavfilter.so.12','bin/lib/libswresample.so.7','FFmpeg-LICENSE.txt','FFmpeg-VERSION.txt'];
export async function nativeMediaAssets(root=join(process.cwd(),'.reporter-native','bundle')){
  const entries={};
  async function collect(directory,prefix=''){
    for(const file of await readdir(directory,{withFileTypes:true})){
      const key=prefix+file.name,path=join(directory,file.name);
      if(file.isDirectory())await collect(path,key+'/');
      else if(file.isFile()){
        const bytes=await readFile(path);
        if(key.startsWith('bin/')&&(bytes.length<64||bytes.subarray(0,4).toString('binary')!=='\x7fELF'||bytes[4]!==2||bytes[5]!==1||bytes.readUInt16LE(18)!==183))throw new Error('Media bundle requires Linux ARM64 ELF files.');
        entries[key]=bytes;
      }
    }
  }
  await collect(root);
  for(const key of required)if(!entries[key])throw new Error('Required native media asset missing: '+key);
  if(entries['FFmpeg-VERSION.txt'].toString().trim()!=='9.0.2')throw new Error('Unexpected FFmpeg package version.');
  return entries;
}
